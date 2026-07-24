import * as cdk from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface PhotoChaseStackProps extends cdk.StackProps {
  /** Deployment environment name: dev | staging | prod. */
  envName: string;
}

/**
 * Core PhotoChase backend: a DynamoDB single table, a private photo bucket, a
 * Cognito user pool (federating social IdPs is configured per-env at deploy
 * time), and an HTTP API backed by a Lambda. Mirrors docs/02-architecture.md.
 */
export class PhotoChaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PhotoChaseStackProps) {
    super(scope, id, props);
    const { envName } = props;

    // Single-table design: GAME#<id> partitions hold the hot game aggregate.
    const table = new dynamodb.Table(this, 'GameTable', {
      tableName: `photochase-${envName}`,
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: envName === 'prod',
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    // Sparse GSI for the referral repository's monthly-cap count query.
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // Private photo storage; access is granted via short-lived presigned URLs.
    const photos = new s3.Bucket(this, 'PhotoBucket', {
      bucketName: `photochase-photos-${envName}-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(envName === 'prod' ? 365 : 30) }],
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      // Allow browser presigned-POST uploads and presigned GET reads.
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `photochase-${envName}`,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      removalPolicy: envName === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    userPool.addClient('AppClient', {
      authFlows: { userSrp: true },
      // Google, Facebook, X, and Apple IdPs are wired per-env with secrets.
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
    });

    // Bundles services/api's Lambda entrypoint (esbuild). The handler reads
    // TABLE_NAME to select the DynamoDB GameRepository (see container.ts).
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(moduleDir, '../../../services/api/src/lambda.ts'),
      handler: 'handler',
      bundling: { format: OutputFormat.ESM, target: 'node20', minify: true },
      environment: {
        TABLE_NAME: table.tableName,
        PHOTO_BUCKET: photos.bucketName,
        USER_POOL_ID: userPool.userPoolId,
      },
    });
    table.grantReadWriteData(apiFn);
    photos.grantReadWrite(apiFn);

    const api = new HttpApi(this, 'HttpApi', { apiName: `photochase-${envName}` });
    api.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFn),
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
  }
}
