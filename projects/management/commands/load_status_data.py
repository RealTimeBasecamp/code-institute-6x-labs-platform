"""
Management command to load Status records from model constants.

Populates the Status lookup table using STATUS_CHOICES defined
in the Status model, ensuring consistency between model constants
and database records.

Usage: python manage.py load_status_data
"""
from django.core.management.base import BaseCommand
from projects.models import Status


class Command(BaseCommand):
    """Load Status records from model constants into the database."""

    help = 'Load status records from Status.STATUS_CHOICES into the database'

    # Map status codes to emojis and metadata
    # Data defined here to keep model clean while allowing rich display
    STATUS_METADATA = {
        Status.STATUS_PROSPECTING: {
            'emoji': '🔍',
            'is_archived': False,
            'includes_in_carbon': False,
        },
        Status.STATUS_PENDING: {
            'emoji': '⏳',
            'is_archived': False,
            'includes_in_carbon': False,
        },
        Status.STATUS_DELAYED: {
            'emoji': '⚠️',
            'is_archived': False,
            'includes_in_carbon': True,
        },
        Status.STATUS_STOPPED: {
            'emoji': '🛑',
            'is_archived': False,
            'includes_in_carbon': True,
        },
        Status.STATUS_IN_PROGRESS: {
            'emoji': '🚀',
            'is_archived': False,
            'includes_in_carbon': True,
        },
        Status.STATUS_COMPLETED: {
            'emoji': '✅',
            'is_archived': False,
            'includes_in_carbon': True,
        },
        Status.STATUS_ARCHIVED_INCLUDED: {
            'emoji': '📦',
            'is_archived': True,
            'includes_in_carbon': True,
        },
        Status.STATUS_ARCHIVED_EXCLUDED: {
            'emoji': '🗄️',
            'is_archived': True,
            'includes_in_carbon': False,
        },
    }

    def handle(self, *args, **options):
        """Create or update Status records from model constants."""
        self.stdout.write('Loading status data from model constants...\n')

        created_count = 0
        updated_count = 0

        for display_order, (code, name) in enumerate(Status.STATUS_CHOICES):
            metadata = self.STATUS_METADATA.get(code, {
                'emoji': '📋',
                'is_archived': False,
                'includes_in_carbon': True,
            })

            status, created = Status.objects.update_or_create(
                code=code,
                defaults={
                    'name': name,
                    'emoji': metadata['emoji'],
                    'is_archived': metadata['is_archived'],
                    'includes_in_carbon': metadata['includes_in_carbon'],
                    'display_order': display_order,
                }
            )

            if created:
                created_count += 1
                self.stdout.write(f"  Created: {status.name} ({status.code})")
            else:
                updated_count += 1
                self.stdout.write(f"  Updated: {status.name} ({status.code})")

        self.stdout.write('')
        self.stdout.write(self.style.SUCCESS(
            f'Status data loaded: {created_count} created, '
            f'{updated_count} updated'
        ))
