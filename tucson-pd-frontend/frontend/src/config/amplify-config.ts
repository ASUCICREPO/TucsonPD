import { Amplify } from 'aws-amplify';

/**
 * Shape of the runtime config file at /cognito-config.json
 * Injected at the root of the site post-build, outside the build process.
 */
interface CognitoConfig {
  region: string;
  userPoolId: string;
  userPoolClientId: string;
  hostedUIDomain: string;
  authenticationFlowType: string;
  oauth: {
    domain: string;
    scope: string[];
    redirectSignIn: string;
    redirectSignOut: string;
    responseType: string;
  };
  groups: {
    users: string;
    admins: string;
  };
  routes: {
    user: string;
    admin: string;
  };
}

/**
 * Fetches /cognito-config.json from the site root and configures AWS Amplify v6.
 *
 * Must be awaited before the React app renders, so that any Amplify auth
 * calls made on mount (e.g. getCurrentUser, fetchAuthSession) have a valid
 * configuration to work with.
 *
 * Throws if the config file is missing, not valid JSON, or missing required fields.
 */
export async function configureAmplify(): Promise<void> {
  let config: CognitoConfig;

  // Fetch the runtime config from the site root
  const response = await fetch('/cognito-config.json');

  if (!response.ok) {
    throw new Error(
      `Failed to load cognito-config.json: ${response.status} ${response.statusText}. ` +
      `Ensure the file exists at the root of the deployed site.`
    );
  }

  try {
    config = await response.json();
  } catch {
    throw new Error(
      'cognito-config.json is not valid JSON. Check the file for syntax errors.'
    );
  }

  // Validate required fields are present before configuring
  const required: (keyof CognitoConfig)[] = [
    'region',
    'userPoolId',
    'userPoolClientId',
    'oauth',
  ];

  for (const field of required) {
    if (!config[field]) {
      throw new Error(
        `cognito-config.json is missing required field: "${field}"`
      );
    }
  }

  // Build the redirect URL lists. The production URL comes from the config file;
  // localhost is added so that Amplify's origin check passes during local development.
  // Both must also be registered in the Cognito app client's allowed callback URLs,
  // which they already are per the CDK stack.
  const redirectSignIn = [
    config.oauth.redirectSignIn,
    'http://localhost:5173',
  ];
  const redirectSignOut = [
    config.oauth.redirectSignOut,
    'http://localhost:5173',
  ];

  // Map the runtime config shape to Amplify v6's expected configuration structure.
  // Amplify v6 uses a nested Auth.Cognito shape rather than the flat aws-exports format.
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: config.userPoolId,
        userPoolClientId: config.userPoolClientId,
        loginWith: {
          oauth: {
            domain: config.oauth.domain,
            scopes: config.oauth.scope,
            redirectSignIn,
            redirectSignOut,
            responseType: config.oauth.responseType as 'code' | 'token',
          },
        },
      },
    },
  });

  console.log(`Amplify configured — region: ${config.region}, userPool: ${config.userPoolId}`);
}