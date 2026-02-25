from django.contrib.auth.mixins import LoginRequiredMixin
from django.contrib.admin.views.decorators import staff_member_required
from django.shortcuts import get_object_or_404, render
from django.http import HttpResponse
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views.generic import ListView
from core.utils.api_usage import get_all_usage, get_summary
from users.models import User

"""
    Staff only views for managing and viewing customers.
"""

# ========================================================
# ============= Dashboard and Customers List =============
@staff_member_required
def customers_dashboard(request):
    """
    Dashboard view for customers. Accessible at path '', named 'customers_dashboard'.
    """
    context = {
        'customers': User.objects.filter(subscription_tier__isnull=False)
    }
    return render(request, 'customers/customers_dashboard.html', context)

# ========================================================
# ============= Customers list / search ==================
@method_decorator(staff_member_required, name='dispatch')
class CustomersListView(LoginRequiredMixin, ListView):
    """
    Customers list/search view. Accessible at path 'customers/', named 'customers_list'.
    Only accessible to staff users.
    """
    model = User
    template_name = 'customers/customers_list.html'
    context_object_name = 'customers'
    paginate_by = 20

    def get_queryset(self):
        return User.objects.filter(subscription_tier__isnull=False).order_by('username')


# Update this function with customer specific logic and remove project logic
@staff_member_required
def customer_detail(request, username):
    """
    Per-customer detail view. Accessible at path 'customers/<username>/', named 'customer_detail'.
    Only accessible to staff users.
    """
    customer = get_object_or_404(User, username=username)
    context = {
        'customer': customer,
        'breadcrumbs': [
            {
                'label': 'Customers',
                'url': reverse('customers:customers_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
        ]
    }

    # Build breadcrumbs for this page
    context['breadcrumbs'].append({
        'label': customer.username,
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })

    # TODO
    # Update card groups to show customer-specific data
    # May need to update card groups for more generic data display
    # card_groups = customer.get_card_groups()
    # card_groups = render_card_groups(card_groups)
    # context['card_groups'] = card_groups

    return render(request, 'customers/customer_detail.html', context)


# ========================================================
# ============= Global analytics views ===================
@staff_member_required
def customers_usage(request):
    """
    Global usage analytics view. Accessible at path 'customers/usage/'.
    """
    context = {
        'api_usage': get_all_usage(),
        'api_summary': get_summary(),
    }
    return render(request, 'customers/customers_usage.html', context)


@staff_member_required
def customers_retention(request):
    """
    Global retention analytics view. Accessible at path 'retention/'.
    """
    context = {
        'retention_data': {}
    }
    return render(request, 'customers/customers_retention.html', context)


@staff_member_required
def customers_revenue(request):
    """
    Global revenue analytics view. Accessible at path 'revenue/'.
    """
    context = {
        'revenue_data': {}
    }
    return render(request, 'customers/customers_revenue.html', context)


# ========================================================
# ============= Per-customer analytics views =============
@staff_member_required
def customer_usage(request, username):
    """
    Per-customer usage analytics view. Accessible at path '<username>/usage/'.
    """
    return HttpResponse("")


@staff_member_required
def customer_retention(request, username):
    """
    Per-customer retention analytics view. Accessible at path '<username>/retention/'.
    """
    return HttpResponse("")


@staff_member_required
def customer_revenue(request, username):
    """
    Per-customer revenue analytics view. Accessible at path '<username>/revenue/'.
    """
    return HttpResponse("")