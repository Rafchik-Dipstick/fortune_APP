import { createPrivateKey, sign } from 'node:crypto';

const bundleId = process.env.APP_BUNDLE_ID ?? 'fortuness.app';
const versionString = process.env.APP_STORE_VERSION ?? '0.2.0';
const eulaUrl = 'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

const keyId = requiredEnvironment('ASC_KEY_ID');
const issuerId = requiredEnvironment('ASC_ISSUER_ID');
const privateKey = createPrivateKey(
  Buffer.from(requiredEnvironment('ASC_API_KEY_P8_BASE64'), 'base64').toString('utf8'),
);
const issuedAt = Math.floor(Date.now() / 1000);
const unsignedToken = `${encodeJson({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encodeJson({
  aud: 'appstoreconnect-v1',
  exp: issuedAt + 10 * 60,
  iat: issuedAt,
  iss: issuerId,
})}`;
const signature = sign('sha256', Buffer.from(unsignedToken), {
  dsaEncoding: 'ieee-p1363',
  key: privateKey,
}).toString('base64url');
const authorization = `Bearer ${unsignedToken}.${signature}`;

function apiPath(path, query = {}) {
  const url = new URL(path, 'https://api.appstoreconnect.apple.com');
  for (const [name, value] of Object.entries(query)) {
    url.searchParams.set(name, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function request(path, options = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authorization,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const details = payload?.errors
      ?.map(
        (error) => `${error.code ?? 'UNKNOWN'}: ${error.detail ?? error.title ?? 'Unknown error'}`,
      )
      .join('; ');
    throw new Error(
      `App Store Connect ${options.method ?? 'GET'} ${path} failed (${response.status}): ${details ?? 'No error details'}`,
    );
  }
  return payload;
}

function one(items, description) {
  if (items.length !== 1) {
    throw new Error(`Expected exactly one ${description}; found ${items.length}`);
  }
  return items[0];
}

const app = one(
  (
    await request(
      apiPath('/v1/apps', {
        'fields[apps]': 'bundleId,name,sku,primaryLocale',
        'filter[bundleId]': bundleId,
        limit: 2,
      }),
    )
  ).data,
  `app with bundle ID ${bundleId}`,
);

const version = one(
  (
    await request(
      apiPath(`/v1/apps/${app.id}/appStoreVersions`, {
        'fields[appStoreVersions]':
          'platform,versionString,appStoreState,appVersionState,releaseType',
        'filter[platform]': 'IOS',
        'filter[versionString]': versionString,
        limit: 10,
      }),
    )
  ).data,
  `iOS App Store version ${versionString}`,
);

const localizations = (
  await request(
    apiPath(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`, {
      'fields[appStoreVersionLocalizations]': 'locale,description',
      limit: 50,
    }),
  )
).data;
const english = one(
  localizations.filter((localization) => localization.attributes.locale === 'en-US'),
  'en-US App Store localization',
);
if (!english.attributes.description?.includes(eulaUrl)) {
  throw new Error(
    `The uploaded en-US description does not contain the Standard EULA URL: ${eulaUrl}`,
  );
}
console.log(`Verified Standard EULA link in ${bundleId} ${versionString} en-US metadata.`);

const submissions = (
  await request(
    apiPath(`/v1/apps/${app.id}/reviewSubmissions`, {
      'fields[reviewSubmissions]': 'platform,submittedDate,state',
      'filter[platform]': 'IOS',
      limit: 200,
    }),
  )
).data.sort((left, right) =>
  String(right.attributes.submittedDate ?? '').localeCompare(
    String(left.attributes.submittedDate ?? ''),
  ),
);

let submission = submissions.find((item) => item.attributes.state === 'UNRESOLVED_ISSUES');
if (!submission) {
  submission = submissions.find((item) =>
    ['READY_FOR_REVIEW', 'WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(item.attributes.state),
  );
}
if (!submission) {
  throw new Error(
    `No resubmittable iOS review submission exists. Current states: ${submissions
      .map((item) => item.attributes.state)
      .join(', ')}`,
  );
}

const reviewItems = (
  await request(
    apiPath(`/v1/reviewSubmissions/${submission.id}/items`, {
      'fields[reviewSubmissionItems]':
        'state,appStoreVersion,inAppPurchaseVersion,subscriptionVersion,subscriptionGroupVersion',
      include: 'appStoreVersion,inAppPurchaseVersion,subscriptionVersion,subscriptionGroupVersion',
      limit: 200,
    }),
  )
).data;
const reviewTargetNames = [
  'appStoreVersion',
  'inAppPurchaseVersion',
  'subscriptionVersion',
  'subscriptionGroupVersion',
];

function reviewTarget(item) {
  for (const name of reviewTargetNames) {
    const target = item.relationships?.[name]?.data;
    if (target) {
      return { id: target.id, name, type: target.type };
    }
  }
  return undefined;
}

for (const item of reviewItems) {
  const target = reviewTarget(item);
  console.log(
    `Review item ${item.id}: ${item.attributes.state} (${target?.name ?? 'unknown'} ${target?.id ?? 'unknown'}).`,
  );
}

if (['UNRESOLVED_ISSUES', 'READY_FOR_REVIEW'].includes(submission.attributes.state)) {
  const rejectedItems = reviewItems.filter((item) => item.attributes.state === 'REJECTED');
  if (submission.attributes.state === 'UNRESOLVED_ISSUES') {
    const rejectedItem = one(rejectedItems, 'rejected review submission item');
    const target = reviewTarget(rejectedItem);
    if (target?.name !== 'appStoreVersion' || target.id !== version.id) {
      throw new Error(
        `Refusing to resolve an unexpected rejected item: ${target?.name ?? 'unknown'} ${target?.id ?? 'unknown'}`,
      );
    }
    await request(`/v1/reviewSubmissionItems/${rejectedItem.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'reviewSubmissionItems',
          id: rejectedItem.id,
          attributes: { resolved: true },
        },
      },
    });
    console.log(`Resolved rejected App Store version item ${rejectedItem.id}.`);
  }

  submission = (
    await request(`/v1/reviewSubmissions/${submission.id}`, {
      method: 'PATCH',
      body: {
        data: {
          type: 'reviewSubmissions',
          id: submission.id,
          attributes: { submitted: true },
        },
      },
    })
  ).data;
  console.log(`Resubmitted App Review submission ${submission.id}.`);
} else {
  console.log(
    `Submission ${submission.id} is already ${submission.attributes.state}; no resubmit mutation was needed.`,
  );
}

for (let attempt = 0; attempt < 10; attempt += 1) {
  submission = (await request(`/v1/reviewSubmissions/${submission.id}`)).data;
  if (['WAITING_FOR_REVIEW', 'IN_REVIEW'].includes(submission.attributes.state)) {
    console.log(`Confirmed submission state: ${submission.attributes.state}.`);
    process.exit(0);
  }
  if (submission.attributes.state === 'UNRESOLVED_ISSUES') {
    throw new Error('The submission remains in UNRESOLVED_ISSUES after resubmission.');
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}

throw new Error(
  `Submission did not reach a review queue; final state: ${submission.attributes.state}`,
);
