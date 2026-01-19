"""
Management command to load navigation items and subscription tiers from JSON into the database.

Usage: python manage.py load_navigation_data
"""
import json
from django.conf import settings
from django.core.management.base import BaseCommand
from core.models import NavigationItem
from users.models import SubscriptionTier


class Command(BaseCommand):
    help = 'Load subscription tiers and navigation items from JSON into the database'

    def handle(self, *args, **options):
        # Load JSON file
        json_path = settings.BASE_DIR / 'core' / 'data' / 'navigation.json'

        if not json_path.exists():
            self.stderr.write(self.style.ERROR(f'Navigation JSON not found: {json_path}'))
            return

        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        self.stdout.write('Loading navigation data from JSON...\n')

        # Create subscription tiers
        tiers = {}
        for tier_data in data.get('tiers', []):
            tier, created = SubscriptionTier.objects.update_or_create(
                slug=tier_data['slug'],
                defaults={
                    'name': tier_data['name'],
                    'level': tier_data['level'],
                    'description': tier_data.get('description', ''),
                    'is_active': True
                }
            )
            tiers[tier_data['slug']] = tier
            status = 'Created' if created else 'Updated'
            self.stdout.write(f"  {status} tier: {tier.name}")

        self.stdout.write(self.style.SUCCESS(f'\n{len(tiers)} subscription tiers loaded'))

        # Create navigation items recursively
        def create_nav_item(item_data, parent=None, order=0):
            """Recursively create navigation item and its children."""
            item, created = NavigationItem.objects.update_or_create(
                item_id=item_data['item_id'],
                defaults={
                    'item_type': item_data.get('item_type', 'link'),
                    'label': item_data['label'],
                    'icon': item_data.get('icon', ''),
                    'url_name': item_data.get('url_name', ''),
                    'is_active': item_data.get('is_active', True),
                    'is_footer': item_data.get('is_footer', False),
                    'staff_only': item_data.get('staff_only', False),
                    'display_order': order,
                    'parent': parent,
                }
            )

            # Set allowed tiers
            tier_slugs = item_data.get('allowed_tiers', [])
            item.allowed_tiers.set([tiers[slug] for slug in tier_slugs if slug in tiers])

            status = 'Created' if created else 'Updated'
            indent = '    ' if parent else '  '
            self.stdout.write(f"{indent}{status} nav item: {item.label}")

            # Process children recursively
            for child_order, child_data in enumerate(item_data.get('children', [])):
                create_nav_item(child_data, parent=item, order=child_order)

            return item

        # Process top-level navigation items
        for order, item_data in enumerate(data.get('navigation', [])):
            create_nav_item(item_data, parent=None, order=order)

        total_items = NavigationItem.objects.count()
        self.stdout.write(self.style.SUCCESS(f'\n{total_items} navigation items loaded'))
        self.stdout.write(self.style.SUCCESS('Navigation data loaded successfully!'))
