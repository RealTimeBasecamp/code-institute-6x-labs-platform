from django import template
from django.utils.safestring import mark_safe
from django.template.loader import render_to_string

register = template.Library()


@register.filter
def split(value, delimiter=','):
    """Split a string by delimiter (default: comma)."""
    if not value:
        return []
    return [item.strip() for item in value.split(delimiter)]


@register.inclusion_tag('components/card.html', takes_context=False)
def card(card_title=None, card_icon=None, card_body=None, snippet_path=None, edit_modal_id=None, edit_form=None, **context):
    """
    Reusable card component supporting both pre-rendered HTML and template snippets.

    FLOW: Template → card tag → (optional render_to_string) → card.html template wrapper

    Usage Option 1 - Pre-rendered HTML:
        # Direct HTML string
        {% card card_title='My Title' card_icon='bi bi-star' card_body='<p>hello</p>' %}

        # Variable from view context
        {% card card_title='Site Info' card_icon='bi bi-info' card_body=site_details_html %}

        # Template loop with pre-rendered content
        {% for item in items %}
            {% card card_title=item.title card_icon=item.icon card_body=item.content %}
        {% endfor %}

    Usage Option 2 - Template snippet (renders template inline):
        # Single object passed to snippet
        {% card card_title='Site Details'
               card_icon='bi bi-info-circle'
               snippet_path='projects/cards/site_details.html'
               project=project %}

        # Multiple context variables passed to snippet
        {% card card_title='Contact Info'
               card_icon='bi bi-people'
               snippet_path='contacts/card.html'
               contact=contact
               company=company %}

        # In a loop with snippet rendering
        {% for item in items %}
            {% card card_title=item.title
                   card_icon=item.icon
                   snippet_path='snippets/item_detail.html'
                   item=item %}
        {% endfor %}

    Usage Option 3 - With edit functionality:
        # Card with edit button that opens a wizard modal at specific form
        {% card card_title='Site Details'
               card_icon='bi bi-info-circle'
               card_body=site_details_html
               edit_modal_id='projectEditWizard'
               edit_form='ProjectEnvironmentForm' %}

    Args:
        card_title (str): Card header title
        card_icon (str): Bootstrap icon class
        card_body (str, optional): HTML content string for the card body.
        snippet_path (str, optional): Path to template snippet to render.
        edit_modal_id (str, optional): ID of modal to open on edit click.
        edit_form (str, optional): Form class name to open in the wizard.
        **context: Named arguments passed to snippet template

    Returns:
        dict: Context passed to components/card.html template

    Note:
        snippet_path is the Django 5.1+ replacement for the old {% include 'template' as variable %} syntax.
    """
    # Determine card body content
    if snippet_path:
        # Render template snippet with provided context
        body_html = render_to_string(snippet_path, context)
        body_content = mark_safe(body_html)
    elif card_body is not None:
        # Use pre-rendered HTML
        body_content = mark_safe(card_body) if isinstance(card_body, str) else card_body
    else:
        body_content = ''

    return {
        'card_title': card_title,
        'card_icon': card_icon,
        'card_body': body_content,
        'edit_modal_id': edit_modal_id,
        'edit_form': edit_form,
    }
