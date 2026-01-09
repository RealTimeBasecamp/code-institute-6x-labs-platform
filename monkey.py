"""
Monkey patches for Django to enable multi-line template tags.

This module modifies Django's template tag regex to support multi-line tags,
making templates more readable when using complex includes or tags with many parameters.
"""
import re
from django.template import base as template_base

# Add support for multi-line template tags by enabling DOTALL flag
# This allows the '.' character in the regex to match newlines
template_base.tag_re = re.compile(template_base.tag_re.pattern, re.DOTALL)
