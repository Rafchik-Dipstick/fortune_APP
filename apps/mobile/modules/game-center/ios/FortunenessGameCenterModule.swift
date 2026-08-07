import ExpoModulesCore
import Foundation
import GameKit
import UIKit

private let authenticationChangeEvent = "onAuthenticationChange"

public final class FortunenessGameCenterModule: Module {
  private var authenticationStarted = false

  public func definition() -> ModuleDefinition {
    Name("FortunenessGameCenter")

    Events(authenticationChangeEvent)

    OnCreate {
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(self.gameCenterAuthenticationChanged),
        name: .GKPlayerAuthenticationDidChangeNotificationName,
        object: nil
      )
    }

    OnDestroy {
      NotificationCenter.default.removeObserver(
        self,
        name: .GKPlayerAuthenticationDidChangeNotificationName,
        object: nil
      )
      if self.authenticationStarted {
        GKLocalPlayer.local.authenticateHandler = nil
      }
    }

    Function("getState") {
      return self.stateSnapshot()
    }

    AsyncFunction("startAuthenticationAsync") { (promise: Promise) in
      DispatchQueue.main.async {
        self.startAuthenticationIfNeeded()
        promise.resolve(self.stateSnapshot())
      }
    }

    AsyncFunction("fetchIdentityVerificationItemsAsync") { (promise: Promise) in
      DispatchQueue.main.async {
        self.fetchIdentityVerificationItems(promise: promise)
      }
    }
  }

  private func startAuthenticationIfNeeded() {
    guard !authenticationStarted else {
      emitCurrentState()
      return
    }
    authenticationStarted = true
    emitState(status: "AUTHENTICATING")

    GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, error in
      DispatchQueue.main.async {
        self?.handleAuthentication(viewController: viewController, error: error)
      }
    }
  }

  private func handleAuthentication(viewController: UIViewController?, error: Error?) {
    if let viewController {
      guard let presenter = appContext?.utilities?.currentViewController() else {
        emitState(status: "UNAVAILABLE", errorCode: "PRESENTATION_UNAVAILABLE")
        return
      }
      emitState(status: "PRESENTING")
      presenter.present(viewController, animated: true)
      return
    }

    if error != nil && !GKLocalPlayer.local.isAuthenticated {
      emitState(status: "UNAVAILABLE", errorCode: "AUTHENTICATION_FAILED")
      return
    }
    emitCurrentState()
  }

  @objc private func gameCenterAuthenticationChanged() {
    DispatchQueue.main.async {
      self.emitCurrentState()
    }
  }

  private func emitCurrentState() {
    emitState(status: GKLocalPlayer.local.isAuthenticated ? "AUTHENTICATED" : "UNAVAILABLE")
  }

  private func emitState(status: String, errorCode: String? = nil) {
    sendEvent(authenticationChangeEvent, stateSnapshot(status: status, errorCode: errorCode))
  }

  private func stateSnapshot(status: String? = nil, errorCode: String? = nil) -> [String: Any] {
    let player = GKLocalPlayer.local
    let authenticated = player.isAuthenticated
    var state: [String: Any] = [
      "status": status ?? (authenticationStarted ? (authenticated ? "AUTHENTICATED" : "AUTHENTICATING") : "NOT_STARTED"),
      "isAuthenticated": authenticated,
      "scopedIdsPersistent": authenticated && player.scopedIDsArePersistent(),
      "restrictions": [
        "isUnderage": authenticated && player.isUnderage,
        "isMultiplayerGamingRestricted": authenticated && player.isMultiplayerGamingRestricted,
        "isPersonalizedCommunicationRestricted": authenticated && player.isPersonalizedCommunicationRestricted
      ]
    ]
    if authenticated {
      state["teamPlayerId"] = player.teamPlayerID
      state["gamePlayerId"] = player.gamePlayerID
      state["alias"] = player.alias
    }
    if let errorCode {
      state["errorCode"] = errorCode
    }
    return state
  }

  private func fetchIdentityVerificationItems(promise: Promise) {
    let player = GKLocalPlayer.local
    guard player.isAuthenticated else {
      promise.reject("E_GAME_CENTER_AUTH_REQUIRED", "Game Center authentication is required.")
      return
    }
    // Persistence is reported, never decided here. This module's job is to say
    // truthfully what Game Center returned; whether a temporary identifier is
    // acceptable is a policy question, and the server owns it -- it refuses one
    // unless its own deployment is local. Rejecting here instead made the
    // policy unreachable, because no proof could be produced to carry the fact.
    let scopedIdsPersistent = player.scopedIDsArePersistent()
    guard let bundleIdentifier = Bundle.main.bundleIdentifier else {
      promise.reject("E_GAME_CENTER_BUNDLE_UNAVAILABLE", "The application bundle identifier is unavailable.")
      return
    }

    player.fetchItems(forIdentityVerificationSignature: { publicKeyURL, signature, salt, timestamp, error in
      if let error {
        // Apple's own reason is the only thing that distinguishes a network
        // failure from an app that Game Center does not recognise. Discarding
        // it left "undefined reason" as the sole symptom of every cause.
        let details = error as NSError
        promise.reject(
          "E_GAME_CENTER_PROOF_UNAVAILABLE",
          "Game Center could not produce an identity proof: \(details.localizedDescription) [\(details.domain) \(details.code)]"
        )
        return
      }
      guard let publicKeyURL, let signature, let salt else {
        promise.reject("E_GAME_CENTER_PROOF_INVALID", "Game Center returned incomplete identity proof items.")
        return
      }
      promise.resolve([
        "teamPlayerId": player.teamPlayerID,
        "gamePlayerId": player.gamePlayerID,
        "bundleId": bundleIdentifier,
        "publicKeyUrl": publicKeyURL.absoluteString,
        "signatureBase64": signature.base64EncodedString(),
        "saltBase64": salt.base64EncodedString(),
        "timestamp": String(timestamp),
        "alias": player.alias,
        "scopedIdsPersistent": scopedIdsPersistent,
        "restrictions": [
          "isUnderage": player.isUnderage,
          "isMultiplayerGamingRestricted": player.isMultiplayerGamingRestricted,
          "isPersonalizedCommunicationRestricted": player.isPersonalizedCommunicationRestricted
        ]
      ])
    })
  }
}
