"""
View protection decorators for subscription-based access control.
"""
from functools import wraps
from django.shortcuts import redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required


def subscription_required(nav_item_id):
    """
    Decorator to check if user's subscription tier has access to a navigation item.

    Staff and superusers bypass this check automatically.

    Usage:
        @subscription_required('project-planner')
        def my_view(request):
            ...

    Args:
        nav_item_id: The item_id of the NavigationItem to check access for
    """
    def decorator(view_func):
        @wraps(view_func)
        @login_required
        def wrapper(request, *args, **kwargs):
            user = request.user

            # Staff and superusers bypass tier checks
            if user.is_staff or user.is_superuser:
                return view_func(request, *args, **kwargs)

            # Check if user has a subscription tier
            if not hasattr(user, 'subscription_tier') or not user.subscription_tier:
                messages.warning(request, 'Please select a subscription plan to access this feature.')
                return redirect('projects:projects_list')  # or wherever your upgrade page is

            # Check feature access
            from .models import NavigationItem
            try:
                nav_item = NavigationItem.objects.get(item_id=nav_item_id)
                if not nav_item.allowed_tiers.filter(pk=user.subscription_tier.pk).exists():
                    messages.warning(
                        request,
                        f'This feature requires a higher subscription tier. '
                        f'Please upgrade to access {nav_item.label}.'
                    )
                    return redirect('projects:projects_list')  # or upgrade page
            except NavigationItem.DoesNotExist:
                # Fail closed - deny access if nav item not found
                messages.error(request, 'Access denied. Please contact support.')
                return redirect('projects:projects_list')

            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def tier_level_required(max_level):
    """
    Decorator to check if user's tier level meets requirement.

    Lower level number = more access (level 0 is highest access).
    Staff and superusers bypass this check automatically.

    Usage:
        @tier_level_required(2)  # Growth tier (level 2) or higher
        def my_view(request):
            ...

    Args:
        max_level: Maximum tier level allowed (0=highest access, 4=lowest)
    """
    def decorator(view_func):
        @wraps(view_func)
        @login_required
        def wrapper(request, *args, **kwargs):
            user = request.user

            # Staff and superusers bypass tier checks
            if user.is_staff or user.is_superuser:
                return view_func(request, *args, **kwargs)

            # Check if user has a subscription tier
            if not hasattr(user, 'subscription_tier') or not user.subscription_tier:
                messages.warning(request, 'Please select a subscription plan to access this feature.')
                return redirect('projects:projects_list')

            # Check tier level (lower = more access)
            if user.subscription_tier.level > max_level:
                messages.warning(
                    request,
                    'This feature requires a higher subscription tier.'
                )
                return redirect('projects:projects_list')

            return view_func(request, *args, **kwargs)
        return wrapper
    return decorator


def staff_or_superuser_required(view_func):
    """
    Decorator that requires user to be staff or superuser.

    Usage:
        @staff_or_superuser_required
        def admin_only_view(request):
            ...
    """
    @wraps(view_func)
    @login_required
    def wrapper(request, *args, **kwargs):
        if not (request.user.is_staff or request.user.is_superuser):
            messages.error(request, 'You do not have permission to access this page.')
            return redirect('projects:projects_list')
        return view_func(request, *args, **kwargs)
    return wrapper
