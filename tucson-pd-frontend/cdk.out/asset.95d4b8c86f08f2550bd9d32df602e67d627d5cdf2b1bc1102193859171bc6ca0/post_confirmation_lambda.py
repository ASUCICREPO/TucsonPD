import json
import boto3
import logging
import os

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize Cognito client
cognito_client = boto3.client('cognito-idp')

# Get environment variables
# USER_POOL_ID comes from the Cognito event, not environment variable
DEFAULT_GROUP = os.environ.get('DEFAULT_GROUP', 'Users')


def lambda_handler(event, context):
    """
    Cognito Post-Confirmation Trigger Lambda Function
    
    Automatically adds newly confirmed users to the default "Users" group.
    This runs after:
    - Email verification is complete (for self-signup)
    - Admin creates and confirms a user
    
    Args:
        event: Cognito trigger event containing user information
        context: Lambda context object
        
    Returns:
        event: Must return the event unchanged for Cognito
    """
    
    logger.info("Post-confirmation trigger invoked")
    logger.info(f"Event: {json.dumps(event, default=str)}")
    
    try:
        # Extract user information from event
        # The userPoolId comes from Cognito in the event
        user_pool_id = event['userPoolId']
        username = event['userName']
        trigger_source = event['triggerSource']
        
        logger.info(f"Processing user: {username}")
        logger.info(f"Trigger source: {trigger_source}")
        logger.info(f"User Pool ID: {user_pool_id}")
        
        # Add user to default group
        logger.info(f"Adding user {username} to group: {DEFAULT_GROUP}")
        
        cognito_client.admin_add_user_to_group(
            UserPoolId=user_pool_id,
            Username=username,
            GroupName=DEFAULT_GROUP
        )
        
        logger.info(f"Successfully added user {username} to {DEFAULT_GROUP} group")
        
        # Check if user has custom attributes that might indicate admin status
        # (Optional: You could check for specific email domains, attributes, etc.)
        user_attributes = event['request'].get('userAttributes', {})
        email = user_attributes.get('email', '')
        
        logger.info(f"User email: {email}")
        
        # Example: Auto-assign admins based on email domain
        # Uncomment and modify if you want specific emails to be admins
        # if email.endswith('@yourdomain.com'):
        #     logger.info(f"Email matches admin domain, adding to Admins group")
        #     cognito_client.admin_add_user_to_group(
        #         UserPoolId=user_pool_id,
        #         Username=username,
        #         GroupName='Admins'
        #     )
        #     logger.info(f"Successfully added user {username} to Admins group")
        
    except cognito_client.exceptions.ResourceNotFoundException as e:
        logger.error(f"Group {DEFAULT_GROUP} not found: {str(e)}")
        # Don't fail the confirmation - user can still sign in
        # Admin can manually add them to a group later
        
    except cognito_client.exceptions.UserNotFoundException as e:
        logger.error(f"User {username} not found: {str(e)}")
        # This shouldn't happen in post-confirmation, but log it
        
    except Exception as e:
        logger.error(f"Unexpected error adding user to group: {str(e)}")
        logger.error(f"Error type: {type(e).__name__}")
        # Don't fail the confirmation - user can still sign in
        # Admin can manually add them to a group later
    
    # IMPORTANT: Always return the event unchanged
    # Cognito requires this for the trigger to complete successfully
    return event