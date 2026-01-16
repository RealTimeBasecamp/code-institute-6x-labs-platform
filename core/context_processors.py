"""
Context processors for navigation and user data.
"""
from django.urls import reverse, NoReverseMatch
from .models import NavigationItem


def navigation_context(request):
    """
    Inject navigation items into all templates, filtered by user's subscription tier.
    Returns navigation tree with 'is_locked' flag for each item.
    Also builds breadcrumbs based on current URL matching navigation hierarchy.

    Staff/superusers see all items as unlocked.
    """
    context = {
        'navigation_items': [],
        'breadcrumbs': [],
        'user_tier': None,
    }

    user = request.user

    # Get all top-level navigation items (no parent)
    top_level_items = NavigationItem.objects.filter(
        parent__isnull=True
    ).prefetch_related('children', 'allowed_tiers').order_by('display_order')

    def resolve_url(url_name):
        """Try to resolve URL name, fall back to returning as-is if not a valid URL name."""
        if not url_name:
            return None
        try:
            return reverse(url_name)
        except NoReverseMatch:
            # Not a valid URL name, return as-is (might be a path)
            return url_name

    def build_nav_tree(items, user):
        """Build navigation tree with access flags."""
        result = []
        is_staff_user = user.is_authenticated and (user.is_staff or user.is_superuser)

        for item in items:
            # Skip staff_only items for non-staff users
            if item.staff_only and not is_staff_user:
                continue

            # Determine if user has access
            if user.is_authenticated:
                is_allowed = item.is_allowed_for_user(user)
            else:
                is_allowed = False

            nav_item = {
                'id': item.item_id,
                'type': item.item_type,
                'label': item.label,
                'icon': item.icon,
                'url': resolve_url(item.url_name),
                'is_active': item.is_active,
                'is_locked': not is_allowed,
                'children': [],
            }

            # Build children if this is a parent item
            if item.item_type == 'parent':
                children = item.children.order_by('display_order')
                nav_item['children'] = build_nav_tree(children, user)

            result.append(nav_item)
        return result

    context['navigation_items'] = build_nav_tree(top_level_items, user)

    # Add user tier info if authenticated
    if user.is_authenticated and hasattr(user, 'subscription_tier'):
        context['user_tier'] = user.subscription_tier

    # Build breadcrumbs by finding nav item matching current URL
    # Normalize path to handle trailing slash inconsistencies
    current_path = request.path.rstrip('/') or '/'

    def find_active_item(items, ancestors=None):
        """
        Recursively search nav tree for item matching current URL.
        Returns (item, ancestors) tuple if found, else (None, None).
        """
        if ancestors is None:
            ancestors = []
        for item in items:
            item_url = (item['url'] or '').rstrip('/') or '/'
            if item_url and item_url == current_path:
                return (item, ancestors)
            if item['children']:
                result = find_active_item(item['children'], ancestors + [item])
                if result[0]:
                    return result
        return (None, None)

    active_item, ancestors = find_active_item(context['navigation_items'])

    if active_item:
        # Build breadcrumb list with Notion-style truncation
        # Pattern: First / ... / Parent / Current (when > 3 levels)
        all_crumbs = ancestors + [active_item]

        if len(all_crumbs) <= 3:
            # Show all breadcrumbs if 3 or fewer
            for i, crumb in enumerate(all_crumbs):
                context['breadcrumbs'].append({
                    'label': crumb['label'],
                    'url': crumb['url'],
                    'is_current': i == len(all_crumbs) - 1,
                    'is_ellipsis': False,
                })
        else:
            # Truncate: First / ... / Parent / Current
            context['breadcrumbs'] = [
                {
                    'label': all_crumbs[0]['label'],
                    'url': all_crumbs[0]['url'],
                    'is_current': False,
                    'is_ellipsis': False,
                },
                {
                    'label': '...',
                    'url': None,
                    'is_current': False,
                    'is_ellipsis': True,
                },
                {
                    'label': all_crumbs[-2]['label'],
                    'url': all_crumbs[-2]['url'],
                    'is_current': False,
                    'is_ellipsis': False,
                },
                {
                    'label': all_crumbs[-1]['label'],
                    'url': all_crumbs[-1]['url'],
                    'is_current': True,
                    'is_ellipsis': False,
                },
            ]

    return context
