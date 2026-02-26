import os
import hashlib
import time
from aws_cdk import (
    Duration,
    Stack,
    RemovalPolicy,
    CfnOutput,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_lambda as _lambda,
    aws_iam as iam,
    aws_cognito as cognito,
    CustomResource,
)
from constructs import Construct
import aws_cdk as cdk


class TucsonPdFrontendStack(Stack):
    """
    CDK Stack for Tucson PD Frontend deployment using AWS Amplify with Cognito Authentication.
    
    This stack creates:
    - Cognito User Pool with email/password authentication
    - Cognito User Pool Groups (Users and Admins)
    - Cognito User Pool Client for Amplify app
    - Cognito Hosted UI domain
    - S3 bucket for storing frontend build artifacts
    - Lambda function for Amplify deployment orchestration
    - Custom Resource to trigger deployment on stack lifecycle events
    """

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)
        
        # ======================================================================
        # 1. GENERATE RANDOM SUFFIX FOR RESOURCE UNIQUENESS
        # ======================================================================
        # Create a unique 8-character suffix from stack metadata
        raw_suffix = f"{self.stack_name}-{self.account}-{time.time()}"
        self.suffix = hashlib.md5(raw_suffix.encode()).hexdigest()[:8]
        
        # ======================================================================
        # 2. VALIDATE BUILD.ZIP EXISTS
        # ======================================================================
        # Construct path to build.zip (relative to this stack file)
        build_zip_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "build.zip"
        )
        
        # Fail fast if build.zip doesn't exist
        if not os.path.exists(build_zip_path):
            raise FileNotFoundError(
                f"build.zip not found at {build_zip_path}. "
                f"Please run frontend_build.sh before deploying this stack."
            )
        
        # ======================================================================
        # 3. CREATE COGNITO USER POOL
        # ======================================================================
        user_pool = cognito.UserPool(
            self,
            "TucsonPdUserPool",
            user_pool_name=f"tucson-pd-user-pool-{self.suffix}",
            # Sign-in configuration
            sign_in_aliases=cognito.SignInAliases(
                email=True,
                username=False,  # Email only, no separate username
            ),
            # Self-service sign-up
            self_sign_up_enabled=True,
            # Auto-verify email addresses
            auto_verify=cognito.AutoVerifiedAttrs(email=True),
            # Password policy
            password_policy=cognito.PasswordPolicy(
                min_length=8,
                require_lowercase=True,
                require_uppercase=True,
                require_digits=True,
                require_symbols=False,  # Optional for better UX
            ),
            # Account recovery
            account_recovery=cognito.AccountRecovery.EMAIL_ONLY,
            # Email settings (using Cognito default email)
            email=cognito.UserPoolEmail.with_cognito(
                reply_to="noreply@verification.com"
            ),
            # Standard attributes
            standard_attributes=cognito.StandardAttributes(
                email=cognito.StandardAttribute(
                    required=True,
                    mutable=True,
                ),
            ),
            # Custom attributes for role-based authorization
            custom_attributes={
                "role": cognito.StringAttribute(
                    min_len=1,
                    max_len=20,
                    mutable=True,  # Allow role changes by admins
                ),
            },
            # MFA configuration
            mfa=cognito.Mfa.OFF,  # No MFA as requested
            # Device tracking
            device_tracking=cognito.DeviceTracking(
                challenge_required_on_new_device=False,
                device_only_remembered_on_user_prompt=True,
            ),
            # Removal policy
            removal_policy=RemovalPolicy.DESTROY,  # Be careful in production!
        )
        
        # ======================================================================
        # 4. CREATE COGNITO USER POOL GROUPS
        # ======================================================================
        # Users group - for regular users
        users_group = cognito.CfnUserPoolGroup(
            self,
            "UsersGroup",
            user_pool_id=user_pool.user_pool_id,
            group_name="Users",
            description="Regular users with access to main application",
            precedence=2,  # Lower precedence (checked second)
        )
        
        # Admins group - for administrators
        admins_group = cognito.CfnUserPoolGroup(
            self,
            "AdminsGroup",
            user_pool_id=user_pool.user_pool_id,
            group_name="Admins",
            description="Administrators with access to admin panel",
            precedence=1,  # Higher precedence (checked first)
        )
        
        # ======================================================================
        # 4.5. CREATE POST-CONFIRMATION LAMBDA FOR AUTO-GROUP ASSIGNMENT
        # ======================================================================
        # Lambda function to automatically add new users to "Users" group
        
        # Create IAM role for Lambda
        post_confirmation_role = iam.Role(
            self,
            "PostConfirmationLambdaRole",
            role_name=f"tucson-pd-post-confirmation-role-{self.suffix}",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description="Execution role for Post-Confirmation Lambda",
        )
        
        # Add CloudWatch Logs permissions
        post_confirmation_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "service-role/AWSLambdaBasicExecutionRole"
            )
        )
        
        # Add wide Cognito permissions to avoid circular dependency
        post_confirmation_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "cognito-idp:AdminAddUserToGroup",
                    "cognito-idp:GetGroup",
                    "cognito-idp:ListGroups",
                ],
                resources=["*"],  # Wide permissions to break circular dependency
            )
        )
        
        # Create Lambda function WITHOUT environment variables that reference user_pool
        post_confirmation_lambda = _lambda.Function(
            self,
            "PostConfirmationLambda",
            function_name=f"tucson-pd-post-confirmation-{self.suffix}",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="post_confirmation_lambda.lambda_handler",
            code=_lambda.Code.from_asset(
                os.path.join(
                    os.path.dirname(__file__),
                    "..",
                    "lambdas",
                    "post_confirmation_lambda"
                )
            ),
            role=post_confirmation_role,
            timeout=Duration.seconds(10),
            environment={
                # USER_POOL_ID will come from the Cognito event itself
                # No need to set it here - breaks circular dependency
                "DEFAULT_GROUP": "Users",
            },
            description="Automatically assigns new users to the Users group",
        )
        
        # Grant Cognito permission to invoke the Lambda (no source_arn to avoid dependency)
        post_confirmation_lambda.add_permission(
            "CognitoInvokePermission",
            principal=iam.ServicePrincipal("cognito-idp.amazonaws.com"),
        )
        
        # Get the underlying CloudFormation User Pool resource
        cfn_user_pool = user_pool.node.default_child
        
        # Add Lambda trigger configuration to User Pool
        cfn_user_pool.lambda_config = cognito.CfnUserPool.LambdaConfigProperty(
            post_confirmation=post_confirmation_lambda.function_arn
        )
        
        # ======================================================================
        # 4.6. CREATE DEFAULT ADMIN USER
        # ======================================================================
        # Lambda to create default admin user on stack creation
        
        # Get admin credentials from CDK context or use defaults
        # Usage: cdk deploy -c adminEmail=admin@example.com -c adminPassword=SecurePass123!
        DEFAULT_ADMIN_EMAIL = self.node.try_get_context("adminEmail") or "admin@tucsonpd.local"
        DEFAULT_ADMIN_PASSWORD = self.node.try_get_context("adminPassword") or "AdminPassword123!"
        
        # Create IAM role for admin creation Lambda
        admin_creator_role = iam.Role(
            self,
            "AdminCreatorLambdaRole",
            role_name=f"tucson-pd-admin-creator-role-{self.suffix}",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description="Role for creating default admin user",
        )
        
        # Add CloudWatch Logs permissions
        admin_creator_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "service-role/AWSLambdaBasicExecutionRole"
            )
        )
        
        # Add Cognito permissions
        admin_creator_role.add_to_policy(
            iam.PolicyStatement(
                effect=iam.Effect.ALLOW,
                actions=[
                    "cognito-idp:AdminCreateUser",
                    "cognito-idp:AdminSetUserPassword",
                    "cognito-idp:AdminAddUserToGroup",
                    "cognito-idp:AdminGetUser",
                    "cognito-idp:AdminDeleteUser",
                ],
                resources=["*"],
            )
        )
        
        # Create Lambda function for admin user creation
        admin_creator_lambda = _lambda.Function(
            self,
            "AdminCreatorLambda",
            function_name=f"tucson-pd-admin-creator-{self.suffix}",
            runtime=_lambda.Runtime.PYTHON_3_12,
            handler="create_admin_user_lambda.lambda_handler",
            code=_lambda.Code.from_asset(
                os.path.join(
                    os.path.dirname(__file__),
                    "..",
                    "lambdas",
                    "create_admin_user_lambda"
                )
            ),
            role=admin_creator_role,
            timeout=Duration.seconds(30),
            description="Creates default admin user on stack creation",
        )
        
        # Create Custom Resource provider
        admin_creator_provider = cdk.custom_resources.Provider(
            self,
            "AdminCreatorProvider",
            on_event_handler=admin_creator_lambda,
        )
        
        # Create Custom Resource to trigger admin user creation
        admin_user_resource = CustomResource(
            self,
            "DefaultAdminUser",
            service_token=admin_creator_provider.service_token,
            properties={
                "UserPoolId": user_pool.user_pool_id,
                "AdminEmail": DEFAULT_ADMIN_EMAIL,
                "AdminPassword": DEFAULT_ADMIN_PASSWORD,
                "AdminGroup": "Admins",
            },
        )
        
        # Ensure admin user is created after groups exist
        admin_user_resource.node.add_dependency(users_group)
        admin_user_resource.node.add_dependency(admins_group)
        
        # ======================================================================
        # 5. CREATE COGNITO USER POOL CLIENT
        # ======================================================================
        user_pool_client = cognito.UserPoolClient(
            self,
            "TucsonPdAppClient",
            user_pool=user_pool,
            user_pool_client_name=f"tucson-pd-app-client-{self.suffix}",
            # OAuth configuration
            o_auth=cognito.OAuthSettings(
                flows=cognito.OAuthFlows(
                    authorization_code_grant=True,
                    implicit_code_grant=False,  # More secure to use authorization code
                ),
                scopes=[
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.PROFILE,
                    cognito.OAuthScope.COGNITO_ADMIN,  # Required by Amplify v6 for fetchUserAttributes()
                ],
                # Placeholder callback URLs - will be updated by Lambda after Amplify app is created
                callback_urls=[
                    "http://localhost:5173",  # Development fallback
                    "https://example.com",    # Placeholder, will be updated
                ],
                logout_urls=[
                    "http://localhost:5173",  # Development fallback
                    "https://example.com",    # Placeholder, will be updated
                ],
            ),
            # Authentication flows
            auth_flows=cognito.AuthFlow(
                user_password=True,  # Allow username/password auth
                user_srp=True,       # Secure Remote Password protocol
                custom=False,
                admin_user_password=True,  # Allow admin to create users
            ),
            # Token validity
            id_token_validity=Duration.minutes(60),
            access_token_validity=Duration.minutes(60),
            refresh_token_validity=Duration.days(30),
            # Security features
            prevent_user_existence_errors=True,  # Don't reveal if user exists
            # Attribute permissions
            read_attributes=cognito.ClientAttributes()
                .with_standard_attributes(email=True, email_verified=True)
                .with_custom_attributes("custom:role"),
            write_attributes=cognito.ClientAttributes()
                .with_standard_attributes(email=True),
            # Enable token revocation
            enable_token_revocation=True,
            # Generate secret (set to False for public clients like SPAs)
            generate_secret=False,
        )
        
        # ======================================================================
        # 6. CREATE COGNITO HOSTED UI DOMAIN
        # ======================================================================
        cognito_domain = user_pool.add_domain(
            "TucsonPdCognitoDomain",
            cognito_domain=cognito.CognitoDomainOptions(
                domain_prefix=f"tucson-pd-app-{self.suffix}",
            ),
        )
        
        # ======================================================================
        # 7. CREATE S3 BUCKET FOR FRONTEND STORAGE
        # ======================================================================
        frontend_bucket = s3.Bucket(
            self,
            "FrontendStoreBucket",
            bucket_name=f"tucson-pd-frontend-store-{self.suffix}",
            removal_policy=RemovalPolicy.DESTROY,
            auto_delete_objects=True,
            versioned=False,
            encryption=s3.BucketEncryption.S3_MANAGED,
            enforce_ssl=True,  # Deny non-HTTPS requests
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
        )
        
        # Add bucket policy to allow Amplify service access
        frontend_bucket.add_to_resource_policy(
            iam.PolicyStatement(
                sid="AllowAmplifyToListBucket",
                effect=iam.Effect.ALLOW,
                principals=[iam.ServicePrincipal("amplify.amazonaws.com")],
                actions=["s3:ListBucket"],
                resources=[frontend_bucket.bucket_arn],
                conditions={
                    "StringEquals": {
                        "aws:SourceAccount": self.account
                    }
                }
            )
        )
        
        frontend_bucket.add_to_resource_policy(
            iam.PolicyStatement(
                sid="AllowAmplifyToGetObjects",
                effect=iam.Effect.ALLOW,
                principals=[iam.ServicePrincipal("amplify.amazonaws.com")],
                actions=["s3:GetObject"],
                resources=[f"{frontend_bucket.bucket_arn}/*"],
                conditions={
                    "StringEquals": {
                        "aws:SourceAccount": self.account
                    }
                }
            )
        )
        
        # ======================================================================
        # 8. UPLOAD BUILD.ZIP TO S3 AS A FILE (NOT EXTRACTED)
        # ======================================================================
        # The Lambda expects build.zip to exist as a file in S3
        # We'll use an Asset to stage the file, then a custom resource to copy it
        
        from aws_cdk import aws_s3_assets as s3_assets
        from aws_cdk import custom_resources as cr
        
        # Create an asset from build.zip (this uploads to CDK's asset bucket)
        build_zip_asset = s3_assets.Asset(
            self,
            "BuildZipAsset",
            path=build_zip_path,
        )
        
        # Create a custom resource to copy build.zip from asset bucket to frontend bucket
        # This preserves the file as-is without extraction
        copy_build_zip = cr.AwsCustomResource(
            self,
            "CopyBuildZip",
            on_create=cr.AwsSdkCall(
                service="S3",
                action="copyObject",
                parameters={
                    "CopySource": f"{build_zip_asset.s3_bucket_name}/{build_zip_asset.s3_object_key}",
                    "Bucket": frontend_bucket.bucket_name,
                    "Key": "build.zip",
                },
                physical_resource_id=cr.PhysicalResourceId.of("build-zip-copy"),
            ),
            on_delete=cr.AwsSdkCall(
                service="S3",
                action="deleteObject",
                parameters={
                    "Bucket": frontend_bucket.bucket_name,
                    "Key": "build.zip",
                },
            ),
            policy=cr.AwsCustomResourcePolicy.from_statements([
                iam.PolicyStatement(
                    actions=["s3:GetObject"],
                    resources=[build_zip_asset.bucket.arn_for_objects(build_zip_asset.s3_object_key)],
                ),
                iam.PolicyStatement(
                    actions=["s3:PutObject", "s3:DeleteObject"],
                    resources=[f"{frontend_bucket.bucket_arn}/build.zip"],
                ),
            ]),
        )
        
        # ======================================================================
        # 9. CREATE IAM ROLE FOR LAMBDA FUNCTION
        # ======================================================================
        lambda_role = iam.Role(
            self,
            "AmplifyDeploymentLambdaRole",
            role_name=f"tucson-pd-amplify-lambda-role-{self.suffix}",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            description="Execution role for Tucson PD Amplify deployment Lambda",
        )
        
        # Add S3 access policy
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                sid="S3BucketAccess",
                effect=iam.Effect.ALLOW,
                actions=[
                    "s3:GetObject",
                    "s3:PutObject",
                    "s3:DeleteObject",
                    "s3:ListBucket",
                ],
                resources=[
                    frontend_bucket.bucket_arn,
                    f"{frontend_bucket.bucket_arn}/*",
                ],
            )
        )
        
        # Add Amplify access policy
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                sid="AmplifyAccess",
                effect=iam.Effect.ALLOW,
                actions=[
                    "amplify:CreateApp",
                    "amplify:UpdateApp",
                    "amplify:DeleteApp",
                    "amplify:CreateBranch",
                    "amplify:UpdateBranch",
                    "amplify:DeleteBranch",
                    "amplify:GetApp",
                    "amplify:GetBranch",
                    "amplify:ListApps",
                    "amplify:ListBranches",
                    "amplify:StartDeployment",
                ],
                resources=["*"],  # Amplify doesn't support resource-level permissions
            )
        )
        
        # Add Cognito access policy (for updating User Pool Client callback URLs)
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                sid="CognitoAccess",
                effect=iam.Effect.ALLOW,
                actions=[
                    "cognito-idp:UpdateUserPoolClient",
                    "cognito-idp:DescribeUserPoolClient",
                ],
                resources=[user_pool.user_pool_arn],
            )
        )
        
        # Attach managed policy for CloudWatch Logs
        lambda_role.add_managed_policy(
            iam.ManagedPolicy.from_aws_managed_policy_name(
                "service-role/AWSLambdaBasicExecutionRole"
            )
        )
        
        # ======================================================================
        # 10. CREATE LAMBDA FUNCTION
        # ======================================================================
        # Construct path to Lambda code directory
        lambda_code_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "lambdas",
            "amplify_deployment_lambda"
        )
        
        # Validate Lambda code directory exists
        if not os.path.exists(lambda_code_path):
            raise FileNotFoundError(
                f"Lambda code directory not found at {lambda_code_path}"
            )
        
        # Determine Python runtime (try 3.13 first, fallback to 3.12)
        try:
            lambda_runtime = _lambda.Runtime.PYTHON_3_13
        except AttributeError:
            lambda_runtime = _lambda.Runtime.PYTHON_3_12
        
        amplify_deployment_lambda = _lambda.Function(
            self,
            "AmplifyDeploymentLambda",
            function_name=f"tucson-pd-amplify-deployment-{self.suffix}",
            runtime=lambda_runtime,
            handler="lambda_function.lambda_handler",
            code=_lambda.Code.from_asset(lambda_code_path),
            role=lambda_role,
            timeout=Duration.seconds(90),  # Increased timeout for Cognito updates
            environment={
                # Original environment variables
                "FRONTEND_BUCKET_NAME": frontend_bucket.bucket_name,
                "FRONTEND_FOLDER_NAME": "build/",
                "AMPLIFY_APP_NAME": f"TucsonPdApp-{self.suffix}",
                # New Cognito environment variables
                "USER_POOL_ID": user_pool.user_pool_id,
                "USER_POOL_CLIENT_ID": user_pool_client.user_pool_client_id,
                "USER_POOL_DOMAIN": f"{cognito_domain.domain_name}.auth.{self.region}.amazoncognito.com",
                "COGNITO_REGION": self.region,
            },
            description="Lambda function to manage Amplify app deployment with Cognito integration for Tucson PD",
        )
        
        # ======================================================================
        # 11. CREATE CUSTOM RESOURCE
        # ======================================================================
        # Custom Resource provider using the Lambda function
        custom_resource_provider = cdk.custom_resources.Provider(
            self,
            "AmplifyDeploymentProvider",
            on_event_handler=amplify_deployment_lambda,
        )
        
        # Create the Custom Resource
        amplify_custom_resource = CustomResource(
            self,
            "AmplifyDeploymentCustomResource",
            service_token=custom_resource_provider.service_token,
            properties={
                "ServiceTimeout": 90,
            },
        )
        
        # Ensure Custom Resource waits for build.zip to be copied to S3
        amplify_custom_resource.node.add_dependency(copy_build_zip)        
        # ======================================================================
        # 12. STACK OUTPUTS
        # ======================================================================
        # Cognito outputs for frontend configuration
        CfnOutput(
            self,
            "UserPoolId",
            value=user_pool.user_pool_id,
            description="Cognito User Pool ID",
            export_name=f"{self.stack_name}-UserPoolId",
        )
        
        CfnOutput(
            self,
            "UserPoolClientId",
            value=user_pool_client.user_pool_client_id,
            description="Cognito User Pool Client ID",
            export_name=f"{self.stack_name}-UserPoolClientId",
        )
        
        CfnOutput(
            self,
            "CognitoHostedUIDomain",
            value=f"https://{cognito_domain.domain_name}.auth.{self.region}.amazoncognito.com",
            description="Cognito Hosted UI Domain URL",
            export_name=f"{self.stack_name}-CognitoHostedUIDomain",
        )
        
        CfnOutput(
            self,
            "CognitoRegion",
            value=self.region,
            description="AWS Region for Cognito",
            export_name=f"{self.stack_name}-CognitoRegion",
        )
        
        # S3 bucket output
        CfnOutput(
            self,
            "FrontendBucketName",
            value=frontend_bucket.bucket_name,
            description="S3 Bucket for frontend storage",
            export_name=f"{self.stack_name}-FrontendBucketName",
        )
        
        # Lambda function output
        CfnOutput(
            self,
            "DeploymentLambdaArn",
            value=amplify_deployment_lambda.function_arn,
            description="Amplify Deployment Lambda Function ARN",
            export_name=f"{self.stack_name}-DeploymentLambdaArn",
        )
        
        # User Pool Groups
        CfnOutput(
            self,
            "UsersGroupName",
            value="Users",
            description="Cognito User Pool Group for regular users",
        )
        
        CfnOutput(
            self,
            "AdminsGroupName",
            value="Admins",
            description="Cognito User Pool Group for administrators",
        )
        
        # Instructions output
        CfnOutput(
            self,
            "PostDeploymentInstructions",
            value="After deployment: 1) Check Amplify console for app URL, 2) Sign in with default admin credentials, 3) Change admin password immediately",
            description="Next steps after stack deployment",
        )
        
        # Default admin credentials output
        CfnOutput(
            self,
            "DefaultAdminCredentials",
            value=f"Email: {DEFAULT_ADMIN_EMAIL} | Password: {DEFAULT_ADMIN_PASSWORD}",
            description="⚠️  Default admin credentials - CHANGE PASSWORD IMMEDIATELY after first login!",
        )