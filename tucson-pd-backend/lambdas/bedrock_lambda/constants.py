"""
Constants and Configuration for Bedrock Processing Lambda

This module contains all environment variables, constants, and logging configuration
for the redaction processing system.
"""

import os
import logging

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================

LOG_LEVEL = logging.INFO
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
# AWS RESOURCE CONFIGURATION
# ============================================================================

# S3 Bucket for case storage
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
if not S3_BUCKET_NAME:
    raise ValueError("S3_BUCKET_NAME environment variable is required")

# DynamoDB table for case metadata
DYNAMODB_TABLE_NAME = os.environ.get("DYNAMODB_TABLE_NAME")
if not DYNAMODB_TABLE_NAME:
    raise ValueError("DYNAMODB_TABLE_NAME environment variable is required")

# DynamoDB table for guidelines metadata
DYNAMODB_GUIDELINES_TABLE_NAME = os.environ.get("DYNAMODB_GUIDELINES_TABLE_NAME")
if not DYNAMODB_GUIDELINES_TABLE_NAME:
    raise ValueError("DYNAMODB_GUIDELINES_TABLE_NAME environment variable is required")

# AWS Region
AWS_REGION = os.environ.get("AWS_REGION", "us-west-2")


# ============================================================================
# S3 PATH CONSTANTS
# ============================================================================

# S3 path templates for guidelines files
S3_PATH_GUIDELINE_PDF = "guidelines/documents/{guideline_id}.pdf"
S3_PATH_GUIDELINE_JSON = "guidelines/processed/{guideline_id}.json"


# ============================================================================
# DYNAMODB STATUS CONSTANTS
# ============================================================================

# Case lifecycle statuses
STATUS_CASE_CREATED = "CASE_CREATED"
STATUS_INTAKE_UPLOADED = "INTAKE_UPLOADED"
STATUS_UNREDACTED_UPLOADED = "UNREDACTED_UPLOADED"
STATUS_PROCESSING = "PROCESSING"
STATUS_REVIEW_READY = "REVIEW_READY"
STATUS_REVIEWING = "REVIEWING"
STATUS_APPLYING_REDACTIONS = "APPLYING_REDACTIONS"
STATUS_COMPLETED = "COMPLETED"
STATUS_CLOSED = "CLOSED"
STATUS_FAILED = "FAILED"


# ============================================================================
# GUIDELINES STATUS CONSTANTS
# ============================================================================

# Guideline statuses
GUIDELINE_STATUS_ACTIVE = "active"
GUIDELINE_STATUS_INACTIVE = "inactive"

# Guideline processing statuses
GUIDELINE_PROCESSING_PENDING = "pending"        # PDF uploaded, waiting for conversion
GUIDELINE_PROCESSING_PROCESSING = "processing"  # Currently being converted
GUIDELINE_PROCESSING_COMPLETED = "completed"    # JSON available, ready for review/activation
GUIDELINE_PROCESSING_FAILED = "failed"          # Conversion failed


# ============================================================================
# BEDROCK MODEL CONFIGURATION
# ============================================================================

# Default Bedrock model ID (can be overridden by environment variable)
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.amazon.nova-pro-v1:0")


# ============================================================================
# PROCESSING CONFIGURATION
# ============================================================================

# Maximum retries for failed operations
MAX_RETRIES = 3

# Timeout for individual operations (seconds)
OPERATION_TIMEOUT = 300  # 5 minutes

# Lambda function timeout should be set to OPERATION_TIMEOUT + buffer
LAMBDA_TIMEOUT = 360  # 6 minutes recommended


logger = logging.getLogger(__name__)
logger.info("Constants module loaded successfully")
logger.info(f"S3 Bucket: {S3_BUCKET_NAME}")
logger.info(f"DynamoDB Cases Table: {DYNAMODB_TABLE_NAME}")
logger.info(f"DynamoDB Guidelines Table: {DYNAMODB_GUIDELINES_TABLE_NAME}")
logger.info(f"AWS Region: {AWS_REGION}")
logger.info(f"Bedrock Model: {BEDROCK_MODEL_ID}")