"""
Prompts Package

This package contains all prompt templates for the Bedrock redaction system.
"""

from . import document_summary
from . import page_analysis
from . import error

__all__ = ['document_summary', 'page_analysis', 'error']