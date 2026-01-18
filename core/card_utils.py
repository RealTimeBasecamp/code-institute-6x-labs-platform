"""
Utility functions for rendering card groups across the site.
"""
from django.template.loader import render_to_string
from django.utils.safestring import mark_safe


def render_card_groups(card_groups):
    """
    Render card groups by processing fields/sections with the field_list template.

    This function prepares card data for display with the {% card %} template tag.

    Args:
        card_groups (list): List of card group dicts with structure:
            [
                {
                    'title': 'Card Title',
                    'icon': 'bi bi-icon-name',
                    'edit_form': 'FormClassName',  # Optional - for edit button
                    'fields': [('Label', 'Value'), ...],  # OR
                    'sections': [{'title': 'Section', 'fields': [...]}]
                },
                ...
            ]

    Returns:
        list: Same structure with 'body_html' added to each group.

    Example:
        card_groups = project.get_card_groups()
        card_groups = render_card_groups(card_groups)
        context['card_groups'] = card_groups
    """
    for group in card_groups:
        # Determine if group has sections or simple fields
        if 'sections' in group:
            context_data = {'sections': group['sections']}
        else:
            context_data = {'fields': group['fields']}

        body_html = render_to_string(
            'components/field_list.html',
            context_data
        )
        group['body_html'] = mark_safe(body_html)

    return card_groups
