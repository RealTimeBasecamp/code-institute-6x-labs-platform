"""
Admin configuration for the core app.

Registers NavigationItem, Coordinate, Address, and Contact models.
"""
from django.contrib import admin
from .models import NavigationItem, Coordinate, Address, Contact


# =============================================================================
# NAVIGATION ADMIN
# =============================================================================

@admin.register(NavigationItem)
class NavigationItemAdmin(admin.ModelAdmin):
    """Admin configuration for NavigationItem model."""

    list_display = [
        'label', 'item_id', 'item_type', 'parent',
        'is_active', 'staff_only', 'display_order'
    ]
    list_filter = ['item_type', 'is_active', 'staff_only', 'allowed_tiers']
    search_fields = ['label', 'item_id']
    ordering = ['display_order', 'label']
    filter_horizontal = ['allowed_tiers']

    fieldsets = (
        (None, {
            'fields': ('item_id', 'label', 'item_type', 'icon', 'url_name')
        }),
        ('Hierarchy', {
            'fields': ('parent', 'display_order')
        }),
        ('Access Control', {
            'fields': ('is_active', 'staff_only', 'allowed_tiers'),
            'description': (
                'Staff/superusers always have access regardless of tier '
                'settings. Staff-only items are hidden from regular users.'
            )
        }),
    )


# =============================================================================
# CORE REFERENCE DATA ADMIN
# =============================================================================

@admin.register(Coordinate)
class CoordinateAdmin(admin.ModelAdmin):
    """Admin configuration for Coordinate model."""

    list_display = ['latitude', 'longitude', 'altitude', 'coordinate_system']
    search_fields = ['what3w']


@admin.register(Address)
class AddressAdmin(admin.ModelAdmin):
    """Admin configuration for Address model."""

    list_display = ['address_line_1', 'city', 'postcode', 'country_code']
    list_filter = ['country_code', 'city']
    search_fields = ['address_line_1', 'city', 'postcode']


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    """Admin configuration for Contact model."""

    list_display = [
        '__str__', 'company_name', 'primary_contact_name', 'land_owner_name'
    ]
    search_fields = ['company_name', 'primary_contact_name', 'land_owner_name']
