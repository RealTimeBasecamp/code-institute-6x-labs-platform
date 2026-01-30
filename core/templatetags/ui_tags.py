"""
UI Component Template Tags

Provides template tags for building UI component data structures directly
in templates without requiring view-level configuration.

Usage:
    {% load ui_tags %}
    {% make_tabs 'simple:Simple,advanced:Advanced' as my_tabs %}
    {% include 'static/components/nav-pills.html' with tabs=my_tabs %}
"""
from django import template

register = template.Library()


@register.simple_tag
def make_tabs(tab_string):
    """
    Create a list of tab dictionaries from a simple string format.

    Format: 'id:label,id:label,id:label:icon'

    Examples:
        {% make_tabs 'simple:Simple,advanced:Advanced' as tabs %}
        {% make_tabs 'table:Table:bi-list,grid:Grid:bi-grid' as tabs %}

    Args:
        tab_string: Comma-separated tabs in format 'id:label' or 'id:label:icon'

    Returns:
        List of dicts: [{'id': 'simple', 'label': 'Simple'}, ...]
    """
    tabs = []
    for tab in tab_string.split(','):
        parts = tab.strip().split(':')
        if len(parts) >= 2:
            tab_dict = {
                'id': parts[0].strip(),
                'label': parts[1].strip()
            }
            if len(parts) >= 3:
                tab_dict['icon'] = parts[2].strip()
            if len(parts) >= 4:
                tab_dict['title'] = parts[3].strip()
            tabs.append(tab_dict)
    return tabs
