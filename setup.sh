#!/bin/bash

################################################################################
# TucsonPD Infrastructure Setup Script
# 
# Usage:
#   ./setup.sh deploy   - Deploy all infrastructure
#   ./setup.sh destroy  - Destroy all infrastructure
#
# This script orchestrates the deployment of:
#   1. Backend Stack (REST API, Lambda, DynamoDB, S3)
#   2. Frontend Build (npm build and zip creation)
#   3. Frontend Stack (S3, Amplify, Cognito)
################################################################################

# Note: Not using 'set -e' globally as CDK commands may have non-standard exit codes
set -o pipefail  # Catch errors in pipes

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="us-west-2"
BACKEND_STACK_NAME="TucsonPdBackendStack"
FRONTEND_STACK_NAME="TucsonPdFrontendStack"
BACKEND_DIR="./tucson-pd-backend"
FRONTEND_DIR="./tucson-pd-frontend"
FRONTEND_BUILD_SCRIPT="./frontend_build.sh"

# CRITICAL: Force all AWS commands to use us-west-2
# This ensures consistency across all AWS CLI and CDK operations
export AWS_DEFAULT_REGION=$AWS_REGION
export AWS_REGION=$AWS_REGION
export CDK_DEFAULT_REGION=$AWS_REGION

# Global variables set during deployment
REST_API_URL=""
AMPLIFY_APP_URL=""

################################################################################
# Utility Functions
################################################################################

print_header() {
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
    echo -e "${BLUE}$1${NC}" >&2
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" >&2
}

print_step() {
    echo -e "${GREEN}[✓]${NC} $1" >&2
}

print_substep() {
    echo -e "    ${BLUE}├─${NC} $1" >&2
}

print_error() {
    echo -e "${RED}[✗]${NC} $1" >&2
}

print_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1" >&2
}

prompt_admin_credentials() {
    # Prompt user for admin email and password with validation.
    # Sets ADMIN_EMAIL and ADMIN_PASSWORD global variables.
    print_header "Admin Credentials Setup"
    
    echo -e "${YELLOW}A default admin user will be created for your application.${NC}" >&2
    echo -e "This user will have access to the admin interface." >&2
    echo "" >&2
    
    # Prompt for admin email
    while true; do
        echo -n "Enter admin email address [default: admin@tucsonpd.local]: " >&2
        read -r ADMIN_EMAIL
        
        # Use default if empty
        if [ -z "$ADMIN_EMAIL" ]; then
            ADMIN_EMAIL="admin@tucsonpd.local"
        fi
        
        # Validate email format (basic validation)
        if [[ "$ADMIN_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
            break
        else
            print_error "Invalid email format. Please try again."
        fi
    done
    
    print_substep "Admin email: $ADMIN_EMAIL"
    echo "" >&2
    
    # Prompt for admin password
    echo -e "Password requirements:" >&2
    echo -e "  • Minimum 8 characters" >&2
    echo -e "  • At least one uppercase letter" >&2
    echo -e "  • At least one lowercase letter" >&2
    echo -e "  • At least one number" >&2
    echo "" >&2
    
    while true; do
        echo -n "Enter admin password [default: AdminPassword123!]: " >&2
        read -rs ADMIN_PASSWORD  # -s flag hides input
        echo "" >&2
        
        # Use default if empty
        if [ -z "$ADMIN_PASSWORD" ]; then
            ADMIN_PASSWORD="AdminPassword123!"
            print_warning "Using default password. Please change it after first login!"
            break
        fi
        
        # Validate password requirements
        if [ ${#ADMIN_PASSWORD} -lt 8 ]; then
            print_error "Password must be at least 8 characters"
            continue
        fi
        
        if ! [[ "$ADMIN_PASSWORD" =~ [A-Z] ]]; then
            print_error "Password must contain at least one uppercase letter"
            continue
        fi
        
        if ! [[ "$ADMIN_PASSWORD" =~ [a-z] ]]; then
            print_error "Password must contain at least one lowercase letter"
            continue
        fi
        
        if ! [[ "$ADMIN_PASSWORD" =~ [0-9] ]]; then
            print_error "Password must contain at least one number"
            continue
        fi
        
        # Confirm password
        echo -n "Confirm admin password: " >&2
        read -rs ADMIN_PASSWORD_CONFIRM
        echo "" >&2
        
        if [ "$ADMIN_PASSWORD" = "$ADMIN_PASSWORD_CONFIRM" ]; then
            break
        else
            print_error "Passwords do not match. Please try again."
        fi
    done
    
    print_step "Admin credentials configured"
    echo "" >&2
    
    # Export for use in deployment
    export ADMIN_EMAIL
    export ADMIN_PASSWORD
}

################################################################################
# Pre-flight Checks
################################################################################

run_preflight_checks() {
    print_header "Running Pre-flight Checks"
    
    # Check if CDK is installed
    if ! command -v cdk &> /dev/null; then
        print_error "AWS CDK is not installed"
        echo "Please install CDK: npm install -g aws-cdk" >&2
        exit 1
    fi
    CDK_VERSION=$(cdk --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)
    print_substep "AWS CDK installed ($CDK_VERSION)"
    
    # Check if AWS CLI is installed and credentials are configured
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI is not installed"
        echo "Please install AWS CLI: https://aws.amazon.com/cli/" >&2
        exit 1
    fi
    print_substep "AWS CLI installed"
    
    # Check AWS credentials
    if ! aws sts get-caller-identity --region $AWS_REGION &> /dev/null; then
        print_error "AWS credentials not configured or invalid"
        echo "Please configure AWS credentials: aws configure" >&2
        exit 1
    fi
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text --region $AWS_REGION)
    print_substep "AWS credentials configured (Account: $AWS_ACCOUNT)"
    
    # Check if CDK is bootstrapped
    BOOTSTRAP_STACK_NAME="CDKToolkit"
    if ! aws cloudformation describe-stacks --stack-name $BOOTSTRAP_STACK_NAME --region $AWS_REGION &> /dev/null; then
        print_error "CDK is not bootstrapped in $AWS_REGION"
        echo "Please bootstrap CDK: cdk bootstrap aws://$AWS_ACCOUNT/$AWS_REGION" >&2
        exit 1
    fi
    print_substep "CDK bootstrapped in $AWS_REGION"
    
    # Check if npm is installed (needed for frontend build)
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        echo "Please install Node.js and npm: https://nodejs.org/" >&2
        exit 1
    fi
    NPM_VERSION=$(npm --version)
    print_substep "npm installed ($NPM_VERSION)"
    
    # Check if required directories exist
    if [ ! -d "$BACKEND_DIR" ]; then
        print_error "Backend directory not found: $BACKEND_DIR"
        exit 1
    fi
    print_substep "Backend directory exists"
    
    if [ ! -d "$FRONTEND_DIR" ]; then
        print_error "Frontend directory not found: $FRONTEND_DIR"
        exit 1
    fi
    print_substep "Frontend directory exists"
    
    # Check if constants backup file exists
    CONSTANTS_BACKUP="$FRONTEND_DIR/frontend/src/components/constants_backup.jsx"
    if [ ! -f "$CONSTANTS_BACKUP" ]; then
        print_error "Constants backup file not found: $CONSTANTS_BACKUP"
        exit 1
    fi
    print_substep "constants_backup.jsx exists"
    
    # Check if frontend build script exists
    if [ ! -f "$FRONTEND_BUILD_SCRIPT" ]; then
        print_error "Frontend build script not found: $FRONTEND_BUILD_SCRIPT"
        exit 1
    fi
    print_substep "frontend_build.sh exists"
    
    print_step "All pre-flight checks passed"
    echo "" >&2
}

################################################################################
# Python Virtual Environment Setup
################################################################################

setup_python_venv() {
    print_header "Setting up Python Virtual Environment"
    
    # Navigate to backend directory
    cd "$BACKEND_DIR" || {
        print_error "Failed to navigate to $BACKEND_DIR"
        exit 1
    }
    
    # Check if Python3 is installed
    if ! command -v python3 &> /dev/null; then
        print_error "python3 is not installed"
        echo "Please install Python 3: https://www.python.org/downloads/" >&2
        exit 1
    fi
    PYTHON_VERSION=$(python3 --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
    print_substep "Python3 installed ($PYTHON_VERSION)"
    
    # Create virtual environment if it doesn't exist
    if [ ! -d ".venv" ]; then
        print_substep "Creating Python virtual environment..."
        python3 -m venv .venv || {
            print_error "Failed to create virtual environment"
            exit 1
        }
        print_substep "Virtual environment created"
    else
        print_substep "Virtual environment already exists"
    fi
    
    # Activate virtual environment
    print_substep "Activating virtual environment..."
    source .venv/bin/activate || {
        print_error "Failed to activate virtual environment"
        exit 1
    }
    print_substep "Virtual environment activated"
    
    # Install Python dependencies
    if [ -f "requirements.txt" ]; then
        print_substep "Installing Python dependencies from requirements.txt..."
        pip3 install -r requirements.txt >&2 || {
            print_error "Failed to install Python dependencies"
            exit 1
        }
        print_substep "Python dependencies installed"
    else
        print_warning "requirements.txt not found in $BACKEND_DIR"
    fi
    
    # Return to original directory
    cd - > /dev/null
    
    print_step "Python virtual environment setup complete"
    echo "" >&2
}

################################################################################
# Rollback Function
################################################################################

rollback_deployment() {
    local stage=$1
    print_header "Rolling Back Deployment (Failed at Stage $stage)"
    
    # Restore constants file
    CONSTANTS_FILE="$FRONTEND_DIR/frontend/src/components/constants.jsx"
    CONSTANTS_BACKUP="$FRONTEND_DIR/frontend/src/components/constants_backup.jsx"
    
    if [ -f "$CONSTANTS_BACKUP" ]; then
        print_substep "Restoring constants.jsx from backup..."
        cp "$CONSTANTS_BACKUP" "$CONSTANTS_FILE" 2>/dev/null || true
    fi
    
    # Remove build artifacts
    print_substep "Removing build artifacts..."
    rm -f "$FRONTEND_DIR/build.zip" 2>/dev/null || true
    rm -rf "$FRONTEND_DIR/frontend/dist" 2>/dev/null || true
    rm -rf "$FRONTEND_DIR/frontend/node_modules" 2>/dev/null || true
    
    # Destroy stacks based on which stage failed
    if [ "$stage" -ge 3 ]; then
        print_substep "Destroying frontend stack..."
        cd "$FRONTEND_DIR"
        cdk destroy $FRONTEND_STACK_NAME --force --region $AWS_REGION >&2 2>&1 || true
        cd - > /dev/null
    fi
    
    if [ "$stage" -ge 1 ]; then
        print_substep "Destroying backend stack..."
        cd "$BACKEND_DIR"
        cdk destroy $BACKEND_STACK_NAME --force --region $AWS_REGION >&2 2>&1 || true
        cd - > /dev/null
    fi
    
    print_error "Deployment failed and has been rolled back"
    exit 1
}

################################################################################
# Deploy Functions
################################################################################

deploy_backend() {
    print_header "[Stage 1/3] Deploying Backend Stack"
    
    cd "$BACKEND_DIR"
    
    # Verify stack name in app.py
    if ! grep -q "$BACKEND_STACK_NAME" app.py; then
        print_error "Stack name mismatch in $BACKEND_DIR/app.py"
        print_error "Expected: $BACKEND_STACK_NAME"
        cd - > /dev/null
        rollback_deployment 1
    fi
    print_substep "Stack name validated: $BACKEND_STACK_NAME"
    
    # Deploy the stack
    print_substep "Deploying $BACKEND_STACK_NAME to $AWS_REGION..."
    
    # Deploy with output to stderr (so it's visible but doesn't contaminate our return value)
    if ! cdk deploy $BACKEND_STACK_NAME --require-approval never --region $AWS_REGION >&2; then
        print_error "Backend stack deployment failed"
        cd "$OLDPWD" > /dev/null 2>&1 || cd - > /dev/null 2>&1 || true
        rollback_deployment 1
    fi
    
    # Get REST API URL from stack outputs
    print_substep "Retrieving REST API URL from stack outputs..."
    REST_API_URL=$(aws cloudformation describe-stacks \
        --stack-name $BACKEND_STACK_NAME \
        --region $AWS_REGION \
        --query 'Stacks[0].Outputs[?OutputKey==`apigatewayurl`].OutputValue' \
        --output text)
    
    if [ -z "$REST_API_URL" ]; then
        print_error "Failed to retrieve REST API URL from stack outputs"
        cd - > /dev/null
        rollback_deployment 1
    fi
    
    print_substep "REST API URL: $REST_API_URL"
    
    print_step "Backend stack deployed successfully"
    echo "" >&2
    
    # Return to original directory
    cd "$OLDPWD" > /dev/null 2>&1 || cd - > /dev/null 2>&1 || true
}

build_frontend() {
    local rest_api_url=$1
    print_header "[Stage 2/3] Building Frontend"
    
    # Make the frontend build script executable
    chmod +x "$FRONTEND_BUILD_SCRIPT"
    
    # Run the frontend build script with REST API URL
    # Note: TucsonPD only uses REST API (no WebSocket)
    if ! "$FRONTEND_BUILD_SCRIPT" "$rest_api_url"; then
        print_error "Frontend build failed"
        rollback_deployment 3
    fi
    
    print_step "Frontend build completed successfully"
    echo "" >&2
}

deploy_frontend() {
    print_header "[Stage 3/3] Deploying Frontend Stack"
    
    cd "$FRONTEND_DIR"
    
    # Verify stack name in app.py
    if ! grep -q "$FRONTEND_STACK_NAME" app.py; then
        print_error "Stack name mismatch in $FRONTEND_DIR/app.py"
        print_error "Expected: $FRONTEND_STACK_NAME"
        cd - > /dev/null
        rollback_deployment 3
    fi
    print_substep "Stack name validated: $FRONTEND_STACK_NAME"
    
    # Verify build.zip exists
    if [ ! -f "build.zip" ]; then
        print_error "build.zip not found in $FRONTEND_DIR"
        cd - > /dev/null
        rollback_deployment 3
    fi
    print_substep "build.zip found"
    
    # Deploy the stack with admin credentials
    print_substep "Deploying $FRONTEND_STACK_NAME to $AWS_REGION with admin credentials..."
    
    # Deploy with admin credentials passed via context
    if ! cdk deploy $FRONTEND_STACK_NAME \
        --require-approval never \
        --region $AWS_REGION \
        -c adminEmail="$ADMIN_EMAIL" \
        -c adminPassword="$ADMIN_PASSWORD"; then
        print_error "Frontend stack deployment failed"
        cd "$OLDPWD" > /dev/null 2>&1 || cd - > /dev/null 2>&1 || true
        rollback_deployment 3
    fi
    
    print_substep "Admin user created: $ADMIN_EMAIL"
    
    # Get the Amplify app URL with branch name
    print_substep "Retrieving Amplify app URL..."
    
    # Get the app ID of the most recently updated app
    AMPLIFY_APP_ID=$(aws amplify list-apps \
        --region $AWS_REGION \
        --query 'apps | sort_by(@, &updateTime) | [-1].appId' \
        --output text 2>/dev/null)
    
    if [ -n "$AMPLIFY_APP_ID" ]; then
        # Get the default domain and branch name
        AMPLIFY_DOMAIN=$(aws amplify get-app \
            --app-id "$AMPLIFY_APP_ID" \
            --region $AWS_REGION \
            --query 'app.defaultDomain' \
            --output text 2>/dev/null)
        
        # Get the production branch name (should be "prod" based on your config)
        AMPLIFY_BRANCH=$(aws amplify list-branches \
            --app-id "$AMPLIFY_APP_ID" \
            --region $AWS_REGION \
            --query 'branches[?stage==`PRODUCTION`].branchName | [0]' \
            --output text 2>/dev/null)
        
        if [ -n "$AMPLIFY_DOMAIN" ] && [ -n "$AMPLIFY_BRANCH" ]; then
            # Construct the full URL: https://[branch].[domain]
            AMPLIFY_APP_URL="https://${AMPLIFY_BRANCH}.${AMPLIFY_DOMAIN}"
            print_substep "Amplify app URL: $AMPLIFY_APP_URL"
        else
            print_warning "Could not retrieve Amplify app URL automatically"
            print_substep "View your Amplify app URL in the AWS Amplify console"
        fi
    else
        print_warning "Could not retrieve Amplify app URL automatically"
        print_substep "View your Amplify app URL in the AWS Amplify console"
    fi
    
    print_step "Frontend stack deployed successfully"
    echo "" >&2
    
    cd - > /dev/null
}

################################################################################
# Destroy Functions
################################################################################

destroy_infrastructure() {
    print_header "Destroying TucsonPD Infrastructure"
    
    echo -e "${YELLOW}WARNING: This will destroy all TucsonPD infrastructure in $AWS_REGION${NC}" >&2
    echo -e "  - $BACKEND_STACK_NAME (Backend: REST API, Lambda, DynamoDB, S3)" >&2
    echo -e "  - $FRONTEND_STACK_NAME (Frontend: S3, Amplify, Cognito)" >&2
    echo "" >&2
    
    # Confirmation prompt
    read -p "Are you sure you want to continue? (yes/no): " -r
    echo "" >&2
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        echo "Destroy cancelled" >&2
        exit 0
    fi
    
    # Step 1: Destroy frontend stack
    print_substep "[1/7] Destroying $FRONTEND_STACK_NAME..."
    cd "$FRONTEND_DIR"
    if aws cloudformation describe-stacks --stack-name $FRONTEND_STACK_NAME --region $AWS_REGION &> /dev/null; then
        cdk destroy $FRONTEND_STACK_NAME --force --region $AWS_REGION >&2 || print_warning "Frontend stack destroy had issues (may already be deleted)"
    else
        print_substep "Frontend stack not found (already deleted or never deployed)"
    fi
    cd - > /dev/null
    
    # Step 2: Remove build.zip
    print_substep "[2/7] Removing build.zip..."
    rm -f "$FRONTEND_DIR/build.zip" 2>/dev/null || true
    
    # Step 3: Remove frontend/dist/
    print_substep "[3/7] Removing frontend/dist/..."
    rm -rf "$FRONTEND_DIR/frontend/dist" 2>/dev/null || true
    
    # Step 4: Remove frontend/node_modules/
    print_substep "[4/7] Removing frontend/node_modules/..."
    rm -rf "$FRONTEND_DIR/frontend/node_modules" 2>/dev/null || true
    
    # Step 5: Restore constants.jsx from backup
    print_substep "[5/7] Restoring constants.jsx from backup..."
    CONSTANTS_FILE="$FRONTEND_DIR/frontend/src/components/constants.jsx"
    CONSTANTS_BACKUP="$FRONTEND_DIR/frontend/src/components/constants_backup.jsx"
    if [ -f "$CONSTANTS_BACKUP" ]; then
        cp "$CONSTANTS_BACKUP" "$CONSTANTS_FILE"
    fi
    
    # Step 6: Destroy backend stack (includes S3 buckets and DynamoDB tables)
    print_substep "[6/7] Destroying $BACKEND_STACK_NAME (includes S3 bucket and DynamoDB tables)..."
    cd "$BACKEND_DIR"
    if aws cloudformation describe-stacks --stack-name $BACKEND_STACK_NAME --region $AWS_REGION &> /dev/null; then
        cdk destroy $BACKEND_STACK_NAME --force --region $AWS_REGION >&2 || print_warning "Backend stack destroy had issues (may already be deleted)"
    else
        print_substep "Backend stack not found (already deleted or never deployed)"
    fi
    cd - > /dev/null
    
    # Step 7: Confirmation message
    print_substep "[7/7] Cleanup completed"
    
    echo "" >&2
    print_step "All resources destroyed successfully!"
}

################################################################################
# Main Function
################################################################################

main() {
    # Check if argument is provided
    if [ $# -eq 0 ]; then
        echo "Usage: $0 {deploy|destroy}" >&2
        echo "" >&2
        echo "Commands:" >&2
        echo "  deploy   - Deploy all infrastructure" >&2
        echo "  destroy  - Destroy all infrastructure" >&2
        exit 1
    fi
    
    MODE=$1
    
    case $MODE in
        deploy)
            echo "" >&2
            print_header "TucsonPD - Deploy Mode"
            echo "" >&2
            
            # Run pre-flight checks
            run_preflight_checks
            
            # Setup Python virtual environment
            setup_python_venv
            
            # Prompt for admin credentials early
            prompt_admin_credentials
            
            # Stage 1: Deploy backend
            deploy_backend
            
            # Validate that we got the required values
            if [ -z "$REST_API_URL" ]; then
                print_error "Failed to retrieve REST API URL from backend deployment"
                exit 1
            fi
            
            # Stage 2: Build frontend
            build_frontend "$REST_API_URL"
            
            # Stage 3: Deploy frontend
            deploy_frontend
            
            # Success!
            print_header "Deployment Completed Successfully!"
            echo -e "${GREEN}✅ All infrastructure has been deployed${NC}" >&2
            echo "" >&2
            echo "Deployment Details:" >&2
            echo "  • REST API URL: $REST_API_URL" >&2
            
            # Display Amplify URL if retrieved
            if [ -n "$AMPLIFY_APP_URL" ]; then
                echo "  • Amplify App URL: $AMPLIFY_APP_URL" >&2
            fi
            
            echo "  • Amplify Console: https://console.aws.amazon.com/amplify/home?region=$AWS_REGION" >&2
            echo "" >&2
            echo "Admin Credentials:" >&2
            echo "  • Email: $ADMIN_EMAIL" >&2
            echo "  • Password: [hidden - you entered this during setup]" >&2
            echo "" >&2
            echo "Next steps:" >&2
            
            # Conditional next steps based on whether URL was retrieved
            if [ -n "$AMPLIFY_APP_URL" ]; then
                echo "  1. Visit your Amplify app at: $AMPLIFY_APP_URL" >&2
                echo "  2. Sign in with the admin credentials above" >&2
                echo "  3. The admin interface will load based on your user role" >&2
                echo "  4. Change your admin password after first login!" >&2
            else
                echo "  1. Visit the Amplify console link above to find your app URL" >&2
                echo "  2. Sign in with the admin credentials above" >&2
                echo "  3. The admin interface will load based on your user role" >&2
                echo "  4. Change your admin password after first login!" >&2
            fi
            
            echo "" >&2
            ;;
            
        destroy)
            echo "" >&2
            print_header "TucsonPD - Destroy Mode"
            echo "" >&2
            
            destroy_infrastructure
            ;;
            
        *)
            echo "Invalid command: $MODE" >&2
            echo "Usage: $0 {deploy|destroy}" >&2
            exit 1
            ;;
    esac
}

# Run main function
main "$@"