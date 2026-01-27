import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';

const BEDROCK_MODEL_ID = 'us.meta.llama3-3-70b-instruct-v1:0';

export class backendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ========================================================================
    // DYNAMODB TABLES
    // ========================================================================

    // Cases Table
    const casesTable = new dynamodb.Table(this, 'CasesTable', {
      tableName: 'TucsonPD-RedactionCases',
      partitionKey: {
        name: 'case_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For testing - change to RETAIN for production
      pointInTimeRecovery: false, // Enable in production
    });

    // Add GSI: officer-index
    casesTable.addGlobalSecondaryIndex({
      indexName: 'officer-index',
      partitionKey: {
        name: 'officer_id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'created_at',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Add GSI: status-index
    casesTable.addGlobalSecondaryIndex({
      indexName: 'status-index',
      partitionKey: {
        name: 'status',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'created_at',
        type: dynamodb.AttributeType.NUMBER,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Guidelines Table
    const guidelinesTable = new dynamodb.Table(this, 'GuidelinesTable', {
      tableName: 'TucsonPD-Guidelines',
      partitionKey: {
        name: 'guideline_id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For testing - change to RETAIN for production
      pointInTimeRecovery: false, // Enable in production
    });

    // ========================================================================
    // S3 BUCKET
    // ========================================================================

    const redactionBucket = new s3.Bucket(this, 'RedactionBucket', {
      bucketName: `tucsonpd-redaction-${this.stackName.toLowerCase()}-${this.account}`,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.PUT,
            s3.HttpMethods.POST,
          ],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
    });

   

    // ========================================================================
    // LAMBDA LAYER - PDF PROCESSING
    // ========================================================================

    const pdfProcessingLayer = new lambda.LayerVersion(this, 'PdfProcessingLayer', {
      code: lambda.Code.fromAsset('./lambdas/layers/pdf-processing-layer.zip'),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: 'PDF processing libraries: pdfplumber and pymupdf',
    });

    // ========================================================================
    // LAMBDA FUNCTION - BEDROCK PROCESSING
    // ========================================================================

    const bedrockLambda = new lambda.Function(this, 'BedrockLambda', {
      functionName: 'TucsonPD-BedrockLambda',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset('./lambdas/bedrock_lambda'),
      timeout: cdk.Duration.seconds(360), // 6 minutes
      memorySize: 1024,
      layers: [pdfProcessingLayer],
      environment: {
        S3_BUCKET_NAME: redactionBucket.bucketName,
        DYNAMODB_TABLE_NAME: casesTable.tableName,
        DYNAMODB_GUIDELINES_TABLE_NAME: guidelinesTable.tableName,
        BEDROCK_MODEL_ID: BEDROCK_MODEL_ID,
      },
    });

    // Grant Bedrock Lambda permissions
    casesTable.grantReadWriteData(bedrockLambda);
    guidelinesTable.grantReadWriteData(bedrockLambda);
    redactionBucket.grantReadWrite(bedrockLambda);

    // Grant Bedrock API access - Full access
    bedrockLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:*'],
        resources: ['*'],
      })
    );

    // Grant AWS Textract permissions for document text extraction
    bedrockLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'textract:DetectDocumentText',
          'textract:StartDocumentTextDetection',
          'textract:GetDocumentTextDetection',
        ],
        resources: ['*'],
      })
    );

    // ========================================================================
    // LAMBDA FUNCTION - DATABASE MANAGEMENT
    // ========================================================================

    const databaseLambda = new lambda.Function(this, 'DatabaseLambda', {
      functionName: 'TucsonPD-DatabaseLambda',
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'lambda_function.lambda_handler',
      code: lambda.Code.fromAsset('./lambdas/database_management_lambda'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        S3_BUCKET_NAME: redactionBucket.bucketName,
        DYNAMODB_TABLE_NAME: casesTable.tableName,
        DYNAMODB_GUIDELINES_TABLE_NAME: guidelinesTable.tableName,
        BEDROCK_LAMBDA_NAME: bedrockLambda.functionName,
      },
    });

    // Grant Database Lambda permissions
    casesTable.grantReadWriteData(databaseLambda);
    guidelinesTable.grantReadWriteData(databaseLambda);
    redactionBucket.grantReadWrite(databaseLambda);

    // Grant Database Lambda permission to invoke Bedrock Lambda
    bedrockLambda.grantInvoke(databaseLambda);

    // ========================================================================
    // API GATEWAY
    // ========================================================================

    const api = new apigateway.RestApi(this, 'RedactionApi', {
      restApiName: 'TucsonPD-RedactionAPI',
      description: 'API for TucsonPD Redaction System',
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 1000,
        throttlingBurstLimit: 2000,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    // Lambda integration
    const databaseIntegration = new apigateway.LambdaIntegration(databaseLambda, {
      proxy: true,
    });

    // ========================================================================
    // API GATEWAY RESOURCES - CASES
    // ========================================================================

    // /cases
    const casesResource = api.root.addResource('cases');
    casesResource.addMethod('POST', databaseIntegration); // Create case
    casesResource.addMethod('GET', databaseIntegration);  // List cases

    // /cases/{case_id}
    const caseIdResource = casesResource.addResource('{case_id}');
    caseIdResource.addMethod('GET', databaseIntegration);    // Get case
    caseIdResource.addMethod('DELETE', databaseIntegration); // Delete case

    // /cases/{case_id}/status
    const caseStatusResource = caseIdResource.addResource('status');
    caseStatusResource.addMethod('PUT', databaseIntegration); // Update status

    // /cases/{case_id}/s3-path
    const caseS3PathResource = caseIdResource.addResource('s3-path');
    caseS3PathResource.addMethod('PUT', databaseIntegration); // Update S3 path

    // ========================================================================
    // API GATEWAY RESOURCES - PRESIGNED URLS
    // ========================================================================

    // /presigned-url
    const presignedUrlResource = api.root.addResource('presigned-url');

    // /presigned-url/upload
    const uploadResource = presignedUrlResource.addResource('upload');
    uploadResource.addMethod('POST', databaseIntegration);

    // /presigned-url/download
    const downloadResource = presignedUrlResource.addResource('download');
    downloadResource.addMethod('POST', databaseIntegration);

    // ========================================================================
    // API GATEWAY RESOURCES - GUIDELINES
    // ========================================================================

    // /guidelines
    const guidelinesResource = api.root.addResource('guidelines');

    // /guidelines/upload
    const guidelinesUploadResource = guidelinesResource.addResource('upload');
    guidelinesUploadResource.addMethod('POST', databaseIntegration);

    // /guidelines/all
    const guidelinesAllResource = guidelinesResource.addResource('all');
    guidelinesAllResource.addMethod('GET', databaseIntegration);

    // /guidelines/active
    const guidelinesActiveResource = guidelinesResource.addResource('active');
    guidelinesActiveResource.addMethod('GET', databaseIntegration);

    // /guidelines/{guideline_id}
    const guidelineIdResource = guidelinesResource.addResource('{guideline_id}');
    guidelineIdResource.addMethod('PUT', databaseIntegration);    // Update JSON
    guidelineIdResource.addMethod('DELETE', databaseIntegration); // Delete

    // /guidelines/{guideline_id}/process
    const guidelineProcessResource = guidelineIdResource.addResource('process');
    guidelineProcessResource.addMethod('POST', databaseIntegration);

    // /guidelines/{guideline_id}/activate
    const guidelineActivateResource = guidelineIdResource.addResource('activate');
    guidelineActivateResource.addMethod('PUT', databaseIntegration);

    // ========================================================================
    // STACK OUTPUTS
    // ========================================================================

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: redactionBucket.bucketName,
      description: 'S3 bucket for storing redaction files',
      exportName: 'RedactionBucketName',
    });

    new cdk.CfnOutput(this, 'CasesTableName', {
      value: casesTable.tableName,
      description: 'DynamoDB table for case metadata',
      exportName: 'CasesTableName',
    });

    new cdk.CfnOutput(this, 'GuidelinesTableName', {
      value: guidelinesTable.tableName,
      description: 'DynamoDB table for guidelines metadata',
      exportName: 'GuidelinesTableName',
    });

    new cdk.CfnOutput(this, 'DatabaseLambdaName', {
      value: databaseLambda.functionName,
      description: 'Database management Lambda function',
      exportName: 'DatabaseLambdaName',
    });

    new cdk.CfnOutput(this, 'BedrockLambdaName', {
      value: bedrockLambda.functionName,
      description: 'Bedrock processing Lambda function',
      exportName: 'BedrockLambdaName',
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: 'ApiGatewayUrl',
    });
  }
}