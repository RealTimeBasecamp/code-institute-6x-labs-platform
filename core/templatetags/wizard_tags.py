"""
Template tags for wizard functionality.

Provides helpers for rendering wizard-related data in templates.
"""
import json

from django import template
from django.utils.safestring import mark_safe

register = template.Library()


@register.simple_tag
def choices_to_json(choices):
    """
    Convert Django model CHOICES to JSON for JavaScript consumption.
    
    Usage in templates:
        {% load wizard_tags %}
        
        <script>
          const PROJECT_TYPES = {% choices_to_json Project.PROJECT_TYPE_CHOICES %};
        </script>
    
    Args:
        choices: List of (value, label) tuples from model CHOICES
    
    Returns:
        Safe JSON object string: {"value1": "Label 1", "value2": "Label 2"}
    """
    if not choices:
        return mark_safe('{}')
    
    choice_dict = {value: label for value, label in choices}
    return mark_safe(json.dumps(choice_dict))


@register.simple_tag
def model_choices(model_class, field_name):
    """
    Get choices from a model class by field name.
    
    Usage:
        {% load wizard_tags %}
        
        <script>
          const SOIL_TYPES = {% model_choices 'projects.Project' 'SOIL_TYPE_CHOICES' %};
        </script>
    
    Args:
        model_class: Model class (passed directly, not as string)
        field_name: Name of the CHOICES attribute (e.g., 'SOIL_TYPE_CHOICES')
    
    Returns:
        Safe JSON object string
    """
    choices = getattr(model_class, field_name, None)
    if not choices:
        return mark_safe('{}')
    
    choice_dict = {value: label for value, label in choices}
    return mark_safe(json.dumps(choice_dict))
