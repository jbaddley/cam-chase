import * as cdk from 'aws-cdk-lib';
import { PhotoChaseStack } from '../lib/photochase-stack.js';

const app = new cdk.App();

// One stack per environment; deploy to separate AWS accounts via CDK context.
for (const envName of ['dev', 'staging', 'prod']) {
  // Social IdP credentials live in Secrets Manager, named per environment via
  // context (`-c dev:idpSecret=photochase/dev/idp`). Without it the stack
  // deploys with Cognito-only sign-in, which is enough for a bare dev stack.
  const idpSecretName = app.node.tryGetContext(`${envName}:idpSecret`) as string | undefined;
  // Purchase-webhook credentials, likewise from Secrets Manager. Without it the
  // API rejects every webhook rather than granting entitlements unverified.
  const purchaseWebhookSecretName = app.node.tryGetContext(`${envName}:webhookSecret`) as string | undefined;

  new PhotoChaseStack(app, `PhotoChase-${envName}`, {
    envName,
    ...(idpSecretName ? { idpSecretName } : {}),
    ...(purchaseWebhookSecretName ? { purchaseWebhookSecretName } : {}),
    env: {
      account: app.node.tryGetContext(`${envName}:account`),
      region: app.node.tryGetContext(`${envName}:region`) ?? 'us-east-1',
    },
  });
}
