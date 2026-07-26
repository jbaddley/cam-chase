import * as cdk from 'aws-cdk-lib';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export interface PhotoChaseStackProps extends cdk.StackProps {
  /** Deployment environment name: dev | staging | prod. */
  envName: string;
  /**
   * Secrets Manager secret holding the social IdP credentials, as JSON keys:
   * googleClientId, googleClientSecret, facebookAppId, facebookAppSecret,
   * appleClientId, appleTeamId, appleKeyId, applePrivateKey, xClientId,
   * xClientSecret. Omit to deploy with Cognito-only sign-in (useful for a bare
   * dev stack); credentials never live in source.
   */
  idpSecretName?: string;
  /**
   * Prefix for the Cognito hosted domain that serves /oauth2/*. Defaults to
   * `photochase-<envName>`; must be globally unique within the region.
   */
  authDomainPrefix?: string;
  /**
   * Extra OAuth callback URLs. The app's custom scheme is always included so
   * the native browser sheet can return to it.
   */
  callbackUrls?: string[];
}

/** Custom scheme the mobile app registers; the browser sheet returns here. */
const APP_REDIRECT_URI = 'photochase://auth';

/**
 * Cognito rejects provider names shorter than 3 characters, so X federates
 * under this name. Clients pass it as `identity_provider` on /oauth2/authorize.
 */
const X_PROVIDER_NAME = 'TwitterX';

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
    // Hosted domain that serves /oauth2/authorize and /oauth2/token. The app
    // opens authorize in a native browser sheet and exchanges the code itself.
    userPool.addDomain('AuthDomain', {
      cognitoDomain: { domainPrefix: props.authDomainPrefix ?? `photochase-${envName}` },
    });

    // Social IdPs read their credentials from Secrets Manager — never source.
    const idpSecret = props.idpSecretName
      ? secretsmanager.Secret.fromSecretNameV2(this, 'IdpSecret', props.idpSecretName)
      : undefined;
    const providers = idpSecret ? this.addSocialProviders(userPool, idpSecret) : [];

    const appClient = userPool.addClient('AppClient', {
      // Public client: no secret, so PKCE is what proves the caller's identity.
      generateSecret: false,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [APP_REDIRECT_URI, ...(props.callbackUrls ?? [])],
        logoutUrls: [APP_REDIRECT_URI, ...(props.callbackUrls ?? [])],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        ...(idpSecret
          ? [
              cognito.UserPoolClientIdentityProvider.GOOGLE,
              cognito.UserPoolClientIdentityProvider.FACEBOOK,
              cognito.UserPoolClientIdentityProvider.APPLE,
              cognito.UserPoolClientIdentityProvider.custom(X_PROVIDER_NAME),
            ]
          : []),
      ],
    });
    // The client must not be created before the IdPs it names exist.
    for (const provider of providers) appClient.node.addDependency(provider);

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

    // Resize Lambda: writes a ≤1024px thumbnail for each uploaded original.
    const resizeFn = new NodejsFunction(this, 'ResizeFn', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(moduleDir, '../../../services/api/src/image-handler.ts'),
      handler: 'resizeHandler',
      bundling: { format: OutputFormat.ESM, target: 'node20', minify: true },
      timeout: cdk.Duration.seconds(30),
      memorySize: 1024,
      environment: { PHOTO_BUCKET: photos.bucketName },
    });
    photos.grantReadWrite(resizeFn);
    // Trigger on new originals (under games/), not on our own thumbs/ output.
    photos.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(resizeFn), {
      prefix: 'games/',
    });

    // CloudWatch alarms: Lambda errors and API latency regressions.
    const period = cdk.Duration.minutes(5);
    const gt = cw.ComparisonOperator.GREATER_THAN_THRESHOLD;
    const notBreaching = cw.TreatMissingData.NOT_BREACHING;
    apiFn.metricErrors({ period }).createAlarm(this, 'ApiErrorsAlarm', {
      alarmName: `photochase-${envName}-api-errors`,
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: gt,
      treatMissingData: notBreaching,
    });
    apiFn.metricDuration({ period, statistic: 'p99' }).createAlarm(this, 'ApiLatencyAlarm', {
      alarmName: `photochase-${envName}-api-p99-latency`,
      threshold: 3000,
      evaluationPeriods: 3,
      comparisonOperator: gt,
      treatMissingData: notBreaching,
    });
    resizeFn.metricErrors({ period }).createAlarm(this, 'ResizeErrorsAlarm', {
      alarmName: `photochase-${envName}-resize-errors`,
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: gt,
      treatMissingData: notBreaching,
    });

    // Cognito JWT authorizer: verifies tokens at the edge; the Lambda reads the
    // verified claims. Access/id tokens are issued by this user pool + app client.
    const jwtAuthorizer = new HttpJwtAuthorizer(
      'JwtAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [appClient.userPoolClientId] },
    );

    const api = new HttpApi(this, 'HttpApi', { apiName: `photochase-${envName}` });
    const integration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    // Provider webhook stays public; the more specific route wins over the catch-all.
    api.addRoutes({ path: '/webhooks/purchase', methods: [HttpMethod.POST], integration });
    api.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration,
      authorizer: jwtAuthorizer,
    });

    new cdk.CfnOutput(this, 'ApiUrl', { value: api.apiEndpoint });
    new cdk.CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId });
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: appClient.userPoolClientId });
  }

  /**
   * Federate the four social IdPs. Every credential comes from the given
   * secret, so nothing sensitive appears in source or in the synthesized
   * template. Email is mapped through so accounts can be linked by verified
   * email (docs/02-architecture.md).
   *
   * Sign in with Apple is not optional: the App Store requires it whenever an
   * app offers third-party social login.
   */
  private addSocialProviders(
    userPool: cognito.UserPool,
    secret: secretsmanager.ISecret,
  ): cognito.IUserPoolIdentityProvider[] {
    const value = (key: string) => secret.secretValueFromJson(key).unsafeUnwrap();
    const emailMapping = { email: cognito.ProviderAttribute.other('email') };

    const google = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleIdp', {
      userPool,
      clientId: value('googleClientId'),
      clientSecretValue: secret.secretValueFromJson('googleClientSecret'),
      scopes: ['openid', 'email', 'profile'],
      attributeMapping: { email: cognito.ProviderAttribute.GOOGLE_EMAIL },
    });

    const facebook = new cognito.UserPoolIdentityProviderFacebook(this, 'FacebookIdp', {
      userPool,
      clientId: value('facebookAppId'),
      clientSecret: value('facebookAppSecret'),
      scopes: ['public_profile', 'email'],
      attributeMapping: { email: cognito.ProviderAttribute.FACEBOOK_EMAIL },
    });

    const apple = new cognito.UserPoolIdentityProviderApple(this, 'AppleIdp', {
      userPool,
      clientId: value('appleClientId'),
      teamId: value('appleTeamId'),
      keyId: value('appleKeyId'),
      privateKeyValue: secret.secretValueFromJson('applePrivateKey'),
      scopes: ['name', 'email'],
      attributeMapping: { email: cognito.ProviderAttribute.APPLE_EMAIL },
    });

    // X has no first-class CDK construct; it federates as a generic OIDC IdP.
    // Cognito requires a provider name of 3-32 characters, so plain "X" is
    // rejected — this name is what clients pass as `identity_provider`.
    const x = new cognito.UserPoolIdentityProviderOidc(this, 'XIdp', {
      userPool,
      name: X_PROVIDER_NAME,
      clientId: value('xClientId'),
      clientSecret: value('xClientSecret'),
      issuerUrl: 'https://x.com/i/oauth2',
      scopes: ['openid', 'email'],
      attributeMapping: emailMapping,
    });

    return [google, facebook, apple, x];
  }
}
