import os
import logging

"""
Constants for Amplify CloudFormation Custom Resource with Cognito Integration
This module contains configuration constants used throughout the application
"""

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================
# Logging configuration - change LOG_LEVEL to control all modules
LOG_LEVEL = logging.INFO  # or logging.DEBUG, logging.WARNING, etc.
LOG_FORMAT = '%(asctime)s - %(levelname)s - %(name)s - %(message)s'

def setup_logging():
    """Configure logging for the entire application"""
    logging.basicConfig(
        level=LOG_LEVEL,
        format=LOG_FORMAT,
        force=True  # Override any existing configuration
    )

# Call setup when constants is imported
setup_logging()

# ============================================================================
# CLOUDFORMATION RESPONSE CONSTANTS
# ============================================================================
# CloudFormation custom resource response statuses
CFN_SUCCESS = "SUCCESS"
CFN_FAILED = "FAILED"

# Standard response messages
RESPONSE_MESSAGES = {
    "CREATE_SUCCESS": "Create operation completed successfully",
    "UPDATE_SUCCESS": "Update operation completed successfully", 
    "DELETE_SUCCESS": "Delete operation completed successfully",
    "GENERIC_SUCCESS": "operation completed successfully",
    "ENV_VAR_MISSING": "Required environment variable is not set",
    "APP_ID_NOT_FOUND": "No appId available, cannot proceed with operation",
    "ZIP_EXTRACTION_ERROR": "Error extracting zip file from S3 bucket",
    "APP_ID_SAVE_ERROR": "Error saving app ID to S3",
    "APP_ID_RETRIEVE_ERROR": "Error retrieving app ID from S3",
    "APP_ID_FILE_NOT_FOUND": "App ID file not found in S3",
    "COGNITO_CONFIG_SAVE_SUCCESS": "Cognito configuration saved to S3 successfully",
    "COGNITO_CONFIG_SAVE_ERROR": "Error saving Cognito configuration to S3",
    "COGNITO_CALLBACK_UPDATE_SUCCESS": "Cognito callback URLs updated successfully",
    "COGNITO_CALLBACK_UPDATE_ERROR": "Error updating Cognito callback URLs",
    "COGNITO_CONFIG_UPDATE_SUCCESS": "Cognito configuration updated with Amplify URL",
    "COGNITO_CONFIG_UPDATE_ERROR": "Error updating Cognito configuration with Amplify URL",
}

# ============================================================================
# ENVIRONMENT VARIABLE VALIDATION - AMPLIFY
# ============================================================================
# Required environment variables with validation
AMPLIFY_APP_NAME = os.environ.get("AMPLIFY_APP_NAME")
if not AMPLIFY_APP_NAME:
    raise ValueError("AMPLIFY_APP_NAME environment variable is required")

FRONTEND_BUCKET_NAME = os.environ.get("FRONTEND_BUCKET_NAME")
if not FRONTEND_BUCKET_NAME:
    raise ValueError("FRONTEND_BUCKET_NAME environment variable is required")

FRONTEND_FOLDER_NAME = os.environ.get("FRONTEND_FOLDER_NAME")
if not FRONTEND_FOLDER_NAME:
    raise ValueError("FRONTEND_FOLDER_NAME environment variable is required")

# Normalize the folder name - remove leading/trailing slashes for S3 best practices
FRONTEND_FOLDER_NAME = FRONTEND_FOLDER_NAME.strip('/')

# ============================================================================
# ENVIRONMENT VARIABLE VALIDATION - COGNITO
# ============================================================================
# Cognito User Pool configuration
USER_POOL_ID = os.environ.get("USER_POOL_ID")
if not USER_POOL_ID:
    raise ValueError("USER_POOL_ID environment variable is required")

USER_POOL_CLIENT_ID = os.environ.get("USER_POOL_CLIENT_ID")
if not USER_POOL_CLIENT_ID:
    raise ValueError("USER_POOL_CLIENT_ID environment variable is required")

USER_POOL_DOMAIN = os.environ.get("USER_POOL_DOMAIN")
if not USER_POOL_DOMAIN:
    raise ValueError("USER_POOL_DOMAIN environment variable is required")

COGNITO_REGION = os.environ.get("COGNITO_REGION")
if not COGNITO_REGION:
    raise ValueError("COGNITO_REGION environment variable is required")

# ============================================================================
# AMPLIFY CONFIGURATION CONSTANTS
# ============================================================================
# Default Amplify app configuration
AMPLIFY_APP_CONFIG = {
    "description": "Our Journey App with Cognito Authentication",
    "platform": "WEB",
    "enableBranchAutoBuild": False,
    "enableBranchAutoDeletion": False,
    "enableBasicAuth": False,  # Using Cognito authentication instead
    "enableAutoBranchCreation": False,
    "customHeaders": ""
}

# Custom rules for SPA routing
AMPLIFY_CUSTOM_RULES = [
    {
        "source": "/<*>",
        "target": "/index.html", 
        "status": "404-200"
    }
]

# Default branch configuration
AMPLIFY_BRANCH_CONFIG = {
    "branchName": "prod",
    "description": "Production branch for Our Journey App",
    "stage": "PRODUCTION",
    "enableNotification": False,
    "enableAutoBuild": True,
    "enableBasicAuth": False,  # Using Cognito authentication instead
    "enablePerformanceMode": False,
    "ttl": "5",
    "enablePullRequestPreview": False,
    "backend": {}
}

# Deployment configuration
AMPLIFY_DEPLOYMENT_CONFIG = {
    "sourceUrlType": "BUCKET_PREFIX"
}

# ============================================================================
# S3 CONFIGURATION CONSTANTS
# ============================================================================
# Default zip file name to extract
DEFAULT_ZIP_FILE = "build.zip"

# S3 batch delete limit (AWS maximum)
S3_DELETE_BATCH_SIZE = 1000

# App ID storage configuration
APP_ID_FILE_NAME = "amplify-app-id.txt"
APP_ID_FILE_KEY = f"{FRONTEND_FOLDER_NAME}/{APP_ID_FILE_NAME}"

# Cognito configuration storage
COGNITO_CONFIG_FILE_NAME = "cognito-config.json"
COGNITO_CONFIG_FILE_KEY = f"{FRONTEND_FOLDER_NAME}/{COGNITO_CONFIG_FILE_NAME}"

# ============================================================================
# COGNITO CONFIGURATION CONSTANTS
# ============================================================================
# OAuth scopes for Cognito authentication
COGNITO_OAUTH_SCOPES = ["openid", "email", "profile"]

# Authentication flow type
COGNITO_AUTH_FLOW_TYPE = "USER_SRP_AUTH"

# Development fallback URLs (for local testing)
COGNITO_DEV_CALLBACK_URL = "http://localhost:5173"
COGNITO_DEV_LOGOUT_URL = "http://localhost:5173"

# Cognito User Pool Groups
COGNITO_USERS_GROUP = "Users"
COGNITO_ADMINS_GROUP = "Admins"

# Frontend route paths
FRONTEND_USER_PATH = "/"
FRONTEND_ADMIN_PATH = "/admin"