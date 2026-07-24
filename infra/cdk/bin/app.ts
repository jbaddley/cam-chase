import * as cdk from 'aws-cdk-lib';
import { PhotoChaseStack } from '../lib/photochase-stack.js';

const app = new cdk.App();

// One stack per environment; deploy to separate AWS accounts via CDK context.
for (const envName of ['dev', 'staging', 'prod']) {
  new PhotoChaseStack(app, `PhotoChase-${envName}`, {
    envName,
    env: {
      account: app.node.tryGetContext(`${envName}:account`),
      region: app.node.tryGetContext(`${envName}:region`) ?? 'us-east-1',
    },
  });
}
