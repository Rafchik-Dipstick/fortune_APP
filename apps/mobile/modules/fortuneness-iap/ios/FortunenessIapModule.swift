import ExpoModulesCore
import Foundation
import StoreKit
import UIKit

private let transactionUpdateEvent = "onTransactionUpdate"

private enum IapModuleError: Error, LocalizedError {
  case invalidAppAccountToken
  case productNotFound(String)
  case sceneUnavailable

  var errorDescription: String? {
    switch self {
    case .invalidAppAccountToken:
      return "The appAccountToken must be a UUID issued by the Fortuneness server."
    case .productNotFound(let productId):
      return "StoreKit returned no product for identifier \(productId)."
    case .sceneUnavailable:
      return "No foreground scene is available to present StoreKit UI."
    }
  }
}

/**
 StoreKit 2 boundary for Fortuneness commerce (spec section 7.2).

 - The `Transaction.updates` listener starts at module creation — before any
   Game Center or bootstrap work — and stays alive for the process lifetime.
   JavaScript buffers delivery work until an account decision exists.
 - Only StoreKit-verified transactions cross this boundary; every payload
   carries the signed JWS representation for server verification.
 - `finish` is exposed as an explicit call so JavaScript finishes only after
   the server accepts delivery with `safeToFinish: true`.
 - Normal launch never calls `AppStore.sync()`; only the explicit
   player-tapped Restore Purchases action invokes `syncAsync`.
 */
public final class FortunenessIapModule: Module {
  private var updatesTask: _Concurrency.Task<Void, Never>?

  public func definition() -> ModuleDefinition {
    Name("FortunenessIap")

    Events(transactionUpdateEvent)

    OnCreate {
      self.updatesTask = _Concurrency.Task(priority: .utility) {
        for await update in Transaction.updates {
          self.emitVerifiedUpdate(update)
        }
      }
    }

    OnDestroy {
      self.updatesTask?.cancel()
      self.updatesTask = nil
    }

    Function("canMakePayments") { () -> Bool in
      return AppStore.canMakePayments
    }

    AsyncFunction("fetchProductsAsync") { (productIds: [String]) -> [[String: Any?]] in
      let products = try await Product.products(for: productIds)
      return products.map { self.serializeProduct($0) }
    }

    AsyncFunction("purchaseAsync") {
      (productId: String, appAccountToken: String) -> [String: Any?] in
      guard let token = UUID(uuidString: appAccountToken) else {
        throw IapModuleError.invalidAppAccountToken
      }
      guard let product = try await Product.products(for: [productId]).first else {
        throw IapModuleError.productNotFound(productId)
      }

      let result = try await product.purchase(options: [.appAccountToken(token)])
      switch result {
      case .success(let verification):
        switch verification {
        case .verified(let transaction):
          return [
            "outcome": "PURCHASED",
            "transaction": self.serializeTransaction(
              transaction,
              jwsRepresentation: verification.jwsRepresentation
            ),
          ]
        case .unverified:
          // Never deliver locally-unverified transactions; leave unfinished.
          return ["outcome": "UNVERIFIED", "transaction": nil]
        }
      case .pending:
        return ["outcome": "PENDING", "transaction": nil]
      case .userCancelled:
        return ["outcome": "CANCELLED", "transaction": nil]
      @unknown default:
        return ["outcome": "UNKNOWN", "transaction": nil]
      }
    }

    AsyncFunction("getCurrentEntitlementsAsync") { () -> [[String: Any?]] in
      var entitlements: [[String: Any?]] = []
      for await result in Transaction.currentEntitlements {
        if case .verified(let transaction) = result {
          entitlements.append(
            self.serializeTransaction(
              transaction,
              jwsRepresentation: result.jwsRepresentation
            )
          )
        }
      }
      return entitlements
    }

    AsyncFunction("getUnfinishedTransactionsAsync") { () -> [[String: Any?]] in
      var unfinished: [[String: Any?]] = []
      for await result in Transaction.unfinished {
        if case .verified(let transaction) = result {
          unfinished.append(
            self.serializeTransaction(
              transaction,
              jwsRepresentation: result.jwsRepresentation
            )
          )
        }
      }
      return unfinished
    }

    AsyncFunction("finishTransactionAsync") { (transactionId: String) -> Bool in
      for await result in Transaction.unfinished {
        if case .verified(let transaction) = result,
          String(transaction.id) == transactionId {
          await transaction.finish()
          return true
        }
      }
      return false
    }

    // Explicit player-tapped Restore Purchases only. Never call on launch.
    AsyncFunction("syncAsync") { () -> Void in
      try await AppStore.sync()
    }

    AsyncFunction("presentManageSubscriptionsAsync") { () -> Void in
      let scene = await MainActor.run { () -> UIWindowScene? in
        UIApplication.shared.connectedScenes
          .compactMap { $0 as? UIWindowScene }
          .first { $0.activationState == .foregroundActive }
      }
      guard let scene else {
        throw IapModuleError.sceneUnavailable
      }
      try await AppStore.showManageSubscriptions(in: scene)
    }
  }

  private func emitVerifiedUpdate(_ result: VerificationResult<Transaction>) {
    guard case .verified(let transaction) = result else {
      return
    }
    sendEvent(
      transactionUpdateEvent,
      self.serializeTransaction(transaction, jwsRepresentation: result.jwsRepresentation)
    )
  }

  private func serializeTransaction(
    _ transaction: Transaction,
    jwsRepresentation: String
  ) -> [String: Any?] {
    return [
      "appAccountToken": transaction.appAccountToken?.uuidString.lowercased(),
      "expiresAtMs": transaction.expirationDate.map { $0.timeIntervalSince1970 * 1_000 },
      "originalTransactionId": String(transaction.originalID),
      "productId": transaction.productID,
      "purchaseAtMs": transaction.purchaseDate.timeIntervalSince1970 * 1_000,
      "revocationAtMs": transaction.revocationDate.map { $0.timeIntervalSince1970 * 1_000 },
      "signedTransaction": jwsRepresentation,
      "transactionId": String(transaction.id),
    ]
  }

  private func serializeProduct(_ product: Product) -> [String: Any?] {
    var subscriptionPeriod: [String: Any?]? = nil
    if let subscription = product.subscription {
      subscriptionPeriod = [
        "unit": String(describing: subscription.subscriptionPeriod.unit),
        "value": subscription.subscriptionPeriod.value,
      ]
    }
    return [
      "description": product.description,
      "displayName": product.displayName,
      "displayPrice": product.displayPrice,
      "productId": product.id,
      "subscriptionPeriod": subscriptionPeriod,
      "type": product.type.rawValue,
    ]
  }
}
