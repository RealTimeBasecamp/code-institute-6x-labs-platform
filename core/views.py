from django.shortcuts import render, redirect
from django.contrib.auth.decorators import login_required

app_name = 'core'


def login_view(request):
    """
    Redirect to allauth's login page.

    Data comes from: None (redirect only)
    Data returned to: Redirects to allauth's account_login URL
    """
    # If user is already authenticated, redirect to dashboard
    if request.user.is_authenticated:
        return redirect('core:dashboard')
    # Otherwise redirect to allauth's login which handles the form properly
    return redirect('account_login')


@login_required
def dashboard_view(request):
    """
    Display the user dashboard.

    Data comes from: Authenticated user session
    Data returned to: Renders dashboard template with user context

    Args:
        request: HttpRequest object with authenticated user

    Returns:
        HttpResponse: Rendered dashboard template
    """
    return render(request, 'core/dashboard.html')