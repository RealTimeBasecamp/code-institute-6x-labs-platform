from django import template

register = template.Library()

@register.filter
def split(value, delimiter):
    if not value:
        return []
    return value.split(delimiter)


@register.filter
def strip(value):
    return value.strip()