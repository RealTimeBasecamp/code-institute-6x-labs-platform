"""
Data parsing utilities for converting raw string values to typed Python objects.

Designed for use in CSV imports, form initial data, and API deserialisation
where values arrive as strings and may be empty or malformed.
"""

from decimal import Decimal, InvalidOperation


def safe_float(val) -> float | None:
    """
    Convert a string (or numeric) value to float, returning None on failure.

    Empty strings, None, and non-numeric values all return None.

    >>> safe_float('3.14')
    3.14
    >>> safe_float('') is None
    True
    >>> safe_float('abc') is None
    True
    """
    if val is None:
        return None
    try:
        s = str(val).strip()
        return float(s) if s else None
    except (ValueError, TypeError):
        return None


def safe_int(val) -> int | None:
    """
    Convert a string (or numeric) value to int, returning None on failure.

    >>> safe_int('42')
    42
    >>> safe_int('3.9')  # truncates via float first
    3
    >>> safe_int('') is None
    True
    """
    if val is None:
        return None
    try:
        s = str(val).strip()
        if not s:
            return None
        # Allow '3.0' strings by converting via float first
        return int(float(s))
    except (ValueError, TypeError):
        return None


def safe_decimal(val) -> Decimal | None:
    """
    Convert a string (or numeric) value to Decimal, returning None on failure.

    Preferred over safe_float() when exact decimal precision matters
    (e.g. currency, area measurements).

    >>> safe_decimal('1.23')
    Decimal('1.23')
    >>> safe_decimal('') is None
    True
    """
    if val is None:
        return None
    try:
        s = str(val).strip()
        return Decimal(s) if s else None
    except (InvalidOperation, TypeError):
        return None


def pipe_separated_list(val, *, strip=True) -> list[str]:
    """
    Split a pipe-separated string into a list, discarding empty entries.

    Used for CSV fields that encode multi-value data as "a|b|c".

    Args:
        val:   Input string (or None / empty).
        strip: Whether to strip whitespace from each item (default True).

    Returns:
        List of non-empty strings.

    >>> pipe_separated_list('clay|loamy|sandy')
    ['clay', 'loamy', 'sandy']
    >>> pipe_separated_list(' oak | ash | ')
    ['oak', 'ash']
    >>> pipe_separated_list('')
    []
    >>> pipe_separated_list(None)
    []
    """
    if not val:
        return []
    s = str(val)
    if strip:
        return [item.strip() for item in s.split('|') if item.strip()]
    return [item for item in s.split('|') if item]


def serialize_value(value):
    """
    Convert a Python value to a JSON-serialisable primitive.

    Handles the common Django-form edge cases:
      - ``Decimal``        → ``str``  (avoids float precision loss)
      - Django model       → ``pk``   (FK fields)
      - date / datetime    → ISO 8601 string
      - django-countries   → country code string
      - list / tuple       → recursively serialised list
      - dict               → recursively serialised dict

    Suitable for use in session storage, ``get_initial_data()`` helpers,
    and ``serialize_form_data()`` in ``core/wizard.py``.

    >>> from decimal import Decimal
    >>> serialize_value(Decimal('3.14'))
    '3.14'
    >>> serialize_value(None) is None
    True
    """
    from datetime import date, datetime

    from django.db import models

    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, models.Model):
        return getattr(value, 'pk', None)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # django-countries CountryField exposes a .code attribute
    if hasattr(value, 'code') and isinstance(getattr(value, 'code', None), str):
        return value.code
    if isinstance(value, (list, tuple)):
        return [serialize_value(v) for v in value]
    if isinstance(value, dict):
        return {k: serialize_value(v) for k, v in value.items()}
    return value
