from aws_cdk import (
    Duration,
    Stack,
    RemovalPolicy,
    CfnOutput,
    aws_dynamodb as dynamodb,
    aws_s3 as s3,
    aws_lambda as _lambda,
    aws_apigateway as apigw,
    aws_iam as iam,
)
from constructs import Construct

BEDROCK_MODEL_ID = 'us.meta.llama3-3-70b-instruct-v1:0'

class TucsonPdBackendStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ======================================================================
        # DYNAMODB TABLES
        # ======================================================================

        # Cases Table
        cases_table = dynamodb.Table(
            self,
            'CasesTable',
            table_name='TucsonPD-RedactionCases',
            partition_key=dynamodb.Attribute(
                name='case_id',
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,  # For testing - change to RETAIN for production
            point_in_time_recovery=False,  # Enable in production
        )

        # Add GSI: officer-index
        cases_table.add_global_secondary_index(
            index_name='officer-index',
            partition_key=dynamodb.Attribute(
                name='officer_id',
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name='created_at',
                type=dynamodb.AttributeType.NUMBER
            ),
            projection_type=dynamodb.ProjectionType.ALL,
        )

        # Add GSI: status-index
        cases_table.add_global_secondary_index(
            index_name='status-index',
            partition_key=dynamodb.Attribute(
                name='status',
                type=dynamodb.AttributeType.STRING
            ),
            sort_key=dynamodb.Attribute(
                name='created_at',
                type=dynamodb.AttributeType.NUMBER
            ),
            projection_type=dynamodb.ProjectionType.ALL,
        )

        # Guidelines Table
        guidelines_table = dynamodb.Table(
            self,
            'GuidelinesTable',
            table_name='TucsonPD-Guidelines',
            partition_key=dynamodb.Attribute(
                name='guideline_id',
                type=dynamodb.AttributeType.STRING
            ),
            billing_mode=dynamodb.BillingMode.PAY_PER_REQUEST,
            removal_policy=RemovalPolicy.DESTROY,  # For testing - change to RETAIN for production
            point_in_time_recovery=False,  # Enable in production
        )

        # ======================================================================
        # S3 BUCKET
        # ======================================================================

        redaction_bucket = s3.Bucket(
            self,
            'RedactionBucket',
            # bucket_name removed - CDK auto-generates unique name
            versioned=True,
            encryption=s3.BucketEncryption.S3_MANAGED,
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            cors=[
                s3.CorsRule(
                    allowed_methods=[
                        s3.HttpMethods.GET,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.POST,
                    ],
                    allowed_origins=['*'],
                    allowed_headers=['*'],
                    exposed_headers=['ETag'],
                    max_age=3000,
                )
            ],
        )

        # ======================================================================
        # LAMBDA LAYER - PDF PROCESSING
        # ======================================================================

        pdf_processing_layer = _lambda.LayerVersion(
            self,
            'PdfProcessingLayer',
            code=_lambda.Code.from_asset('./lambdas/layers/pdf-processing-layer.zip'),
            compatible_runtimes=[_lambda.Runtime.PYTHON_3_12],
            description='PDF processing libraries: pdfplumber and pymupdf',
        )

        # ======================================================================
        # LAMBDA FUNCTION - BEDROCK PROCESSING
        # ======================================================================

        bedrock_lambda = _lambda.Function(
            self,
            'BedrockLambda',
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler='lambda_function.lambda_handler',
            code=_lambda.Code.from_asset('./lambdas/bedrock_lambda'),
            timeout=Duration.seconds(360),  # 6 minutes
            memory_size=1024,
            layers=[pdf_processing_layer],
            environment={
                'S3_BUCKET_NAME': redaction_bucket.bucket_name,
                'DYNAMODB_TABLE_NAME': cases_table.table_name,
                'DYNAMODB_GUIDELINES_TABLE_NAME': guidelines_table.table_name,
                'BEDROCK_MODEL_ID': BEDROCK_MODEL_ID,
            },
            description='Bedrock Lambda for PDF redaction processing'
        )

        # Grant Bedrock Lambda permissions
        cases_table.grant_read_write_data(bedrock_lambda)
        guidelines_table.grant_read_write_data(bedrock_lambda)
        redaction_bucket.grant_read_write(bedrock_lambda)

        # Grant Bedrock API access - Full access
        bedrock_lambda.add_to_role_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=['bedrock:*'],
                resources=['*'],
            )
        )

        # Grant AWS Textract permissions for document text extraction
        bedrock_lambda.add_to_role_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    'textract:DetectDocumentText',
                    'textract:StartDocumentTextDetection',
                    'textract:GetDocumentTextDetection',
                ],
                resources=['*'],
            )
        )

        # ======================================================================
        # LAMBDA FUNCTION - DATABASE MANAGEMENT
        # ======================================================================

        database_lambda = _lambda.Function(
            self,
            'DatabaseLambda',
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler='lambda_function.lambda_handler',
            code=_lambda.Code.from_asset('./lambdas/database_management_lambda'),
            timeout=Duration.seconds(30),
            memory_size=512,
            environment={
                'S3_BUCKET_NAME': redaction_bucket.bucket_name,
                'DYNAMODB_TABLE_NAME': cases_table.table_name,
                'DYNAMODB_GUIDELINES_TABLE_NAME': guidelines_table.table_name,
                'BEDROCK_LAMBDA_NAME': bedrock_lambda.function_name,
            },
            description='Database management Lambda for API operations'
        )

        # Grant Database Lambda permissions
        cases_table.grant_read_write_data(database_lambda)
        guidelines_table.grant_read_write_data(database_lambda)
        redaction_bucket.grant_read_write(database_lambda)

        # Grant Database Lambda permission to invoke Bedrock Lambda
        bedrock_lambda.grant_invoke(database_lambda)

        # ======================================================================
        # API GATEWAY
        # ======================================================================

        api = apigw.RestApi(
            self,
            'RedactionApi',
            rest_api_name='TucsonPD-RedactionAPI',
            description='API for TucsonPD Redaction System',
            deploy_options=apigw.StageOptions(
                stage_name='prod',
                throttling_rate_limit=1000,
                throttling_burst_limit=2000,
            ),
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=[
                    'Content-Type',
                    'Authorization',
                    'X-Amz-Date',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                ],
            ),
        )

        # Lambda integration
        database_integration = apigw.LambdaIntegration(
            database_lambda,
            proxy=True
        )

        # ======================================================================
        # API GATEWAY RESOURCES - CASES
        # ======================================================================

        # /cases
        cases_resource = api.root.add_resource('cases')
        cases_resource.add_method('POST', database_integration)  # Create case
        cases_resource.add_method('GET', database_integration)   # List cases

        # /cases/{case_id}
        case_id_resource = cases_resource.add_resource('{case_id}')
        case_id_resource.add_method('GET', database_integration)     # Get case
        case_id_resource.add_method('DELETE', database_integration)  # Delete case

        # /cases/{case_id}/status
        case_status_resource = case_id_resource.add_resource('status')
        case_status_resource.add_method('PUT', database_integration)  # Update status

        # /cases/{case_id}/s3-path
        case_s3_path_resource = case_id_resource.add_resource('s3-path')
        case_s3_path_resource.add_method('PUT', database_integration)  # Update S3 path

        # ======================================================================
        # API GATEWAY RESOURCES - PRESIGNED URLS
        # ======================================================================

        # /presigned-url
        presigned_url_resource = api.root.add_resource('presigned-url')

        # /presigned-url/upload
        upload_resource = presigned_url_resource.add_resource('upload')
        upload_resource.add_method('POST', database_integration)

        # /presigned-url/download
        download_resource = presigned_url_resource.add_resource('download')
        download_resource.add_method('POST', database_integration)

        # ======================================================================
        # API GATEWAY RESOURCES - GUIDELINES
        # ======================================================================

        # /guidelines
        guidelines_resource = api.root.add_resource('guidelines')

        # /guidelines/upload
        guidelines_upload_resource = guidelines_resource.add_resource('upload')
        guidelines_upload_resource.add_method('POST', database_integration)

        # /guidelines/all
        guidelines_all_resource = guidelines_resource.add_resource('all')
        guidelines_all_resource.add_method('GET', database_integration)

        # /guidelines/active
        guidelines_active_resource = guidelines_resource.add_resource('active')
        guidelines_active_resource.add_method('GET', database_integration)

        # /guidelines/{guideline_id}
        guideline_id_resource = guidelines_resource.add_resource('{guideline_id}')
        guideline_id_resource.add_method('PUT', database_integration)     # Update JSON
        guideline_id_resource.add_method('DELETE', database_integration)  # Delete

        # /guidelines/{guideline_id}/process
        guideline_process_resource = guideline_id_resource.add_resource('process')
        guideline_process_resource.add_method('POST', database_integration)

        # /guidelines/{guideline_id}/activate
        guideline_activate_resource = guideline_id_resource.add_resource('activate')
        guideline_activate_resource.add_method('PUT', database_integration)

        # /guidelines/{guideline_id}/rules
        guideline_rules_resource = guideline_id_resource.add_resource('rules')
        guideline_rules_resource.add_method('GET', database_integration)  # Get rules content

        # ======================================================================
        # STACK OUTPUTS
        # ======================================================================

        CfnOutput(
            self,
            's3-bucket-name',
            value=redaction_bucket.bucket_name,
            description='S3 bucket for storing redaction files',
            export_name='RedactionBucketName',
        )

        CfnOutput(
            self,
            'cases-table-name',
            value=cases_table.table_name,
            description='DynamoDB table for case metadata',
            export_name='CasesTableName',
        )

        CfnOutput(
            self,
            'guidelines-table-name',
            value=guidelines_table.table_name,
            description='DynamoDB table for guidelines metadata',
            export_name='GuidelinesTableName',
        )

        CfnOutput(
            self,
            'database-lambda-name',
            value=database_lambda.function_name,
            description='Database management Lambda function',
            export_name='DatabaseLambdaName',
        )

        CfnOutput(
            self,
            'bedrock-lambda-name',
            value=bedrock_lambda.function_name,
            description='Bedrock processing Lambda function',
            export_name='BedrockLambdaName',
        )

        CfnOutput(
            self,
            'api-gateway-url',
            value=api.url,
            description='API Gateway endpoint URL',
            export_name='ApiGatewayUrl',
        )