"""
Project edit wizard forms.

Reuses the creation wizard forms but loads existing project instance data
and disables auto-generated fields for display only.

Template convention: projects/wizard_steps/edit_project/{step_name}.html
(Falls back to create_project templates if edit-specific ones don't exist)
"""
from django.db import transaction
from django.shortcuts import get_object_or_404
from core.wizard import BaseWizardView, _clean_value
from core.wizards import register_wizard
from projects.models import Project

# Reuse forms from create_project wizard
from ..create_project.basic_info import ProjectBasicInfoForm
from ..create_project.environment import ProjectEnvironmentForm
from ..create_project.address import ProjectAddressForm
from ..create_project.coordinates import ProjectCoordinatesForm
from ..create_project.contact import ProjectContactForm
from ..create_project.summary import ProjectSummaryForm


class ProjectEditWizard(BaseWizardView):
    """
    Project edit wizard.

    Updates an existing Project and related Address, Contact, and Coordinate
    records through a multi-step wizard interface. Automatically disables
    auto-generated fields.
    """

    wizard_name = 'project_edit'
    mode = 'update'  # This wizard updates existing objects
    success_url = '/projects/project-planner/{slug}/'
    success_message = 'Project updated successfully!'

    forms = [
        ProjectBasicInfoForm,
        ProjectEnvironmentForm,
        ProjectAddressForm,
        ProjectCoordinatesForm,
        ProjectContactForm,
        ProjectSummaryForm,
    ]

    def get_project_instance(self, request):
        """Get the project being edited from wizard context."""
        wizard_data = self.get_wizard_data(request)
        context = wizard_data.get('context', {})
        project_slug = context.get('project_slug')

        if not project_slug:
            return None

        return get_object_or_404(
            Project.objects.select_related('address', 'contact', 'coordinates'),
            slug=project_slug
        )

    def get_initial_data(self, request):
        """Pre-populate forms with existing project data."""
        from decimal import Decimal

        project = self.get_project_instance(request)
        if not project:
            return {}

        # Helper function to convert Decimal and other objects to JSON-serializable values
        def serialize_value(value):
            if isinstance(value, Decimal):
                return str(value)
            # Handle django-countries CountryField
            if hasattr(value, 'code'):
                return value.code
            return value

        initial_data = {
            # Step 0: Basic Info
            '0': {
                'name': project.name,
                'project_type': project.project_type,
                'description': project.description,
            },
            # Step 1: Environment
            '1': {
                'soil_type': project.soil_type,
                'climate': project.climate,
                'area_hectares': serialize_value(project.area_hectares),
            },
            # Step 2: Address
            '2': {
                'address_line_1': project.address.address_line_1 if project.address else '',
                'address_line_2': project.address.address_line_2 if project.address else '',
                'city': project.address.city if project.address else '',
                'region': project.address.region if project.address else '',
                'postcode': project.address.postcode if project.address else '',
                'country_code': serialize_value(project.address.country_code) if project.address else '',
            },
            # Step 3: Coordinates
            '3': {
                'latitude': serialize_value(project.coordinates.latitude) if project.coordinates else None,
                'longitude': serialize_value(project.coordinates.longitude) if project.coordinates else None,
                'altitude': serialize_value(project.coordinates.altitude) if project.coordinates else None,
                'elevation': serialize_value(project.coordinates.elevation) if project.coordinates else None,
                'coordinate_system': project.coordinates.coordinate_system if project.coordinates else '',
                'what3w': project.coordinates.what3w if project.coordinates else '',
            },
            # Step 4: Contact
            '4': {
                'company_name': project.contact.company_name if project.contact else '',
                'company_email': project.contact.company_email if project.contact else '',
                'company_phone': project.contact.company_phone if project.contact else '',
                'primary_contact_name': project.contact.primary_contact_name if project.contact else '',
                'primary_contact_email': project.contact.primary_contact_email if project.contact else '',
                'primary_contact_phone': project.contact.primary_contact_phone if project.contact else '',
                'land_owner_name': project.contact.land_owner_name if project.contact else '',
                'land_owner_email': project.contact.land_owner_email if project.contact else '',
                'land_owner_phone': project.contact.land_owner_phone if project.contact else '',
                'secondary_contact_name': project.contact.secondary_contact_name if project.contact else '',
                'secondary_contact_email': project.contact.secondary_contact_email if project.contact else '',
                'secondary_contact_phone': project.contact.secondary_contact_phone if project.contact else '',
            },
        }

        return initial_data

    def get_form_kwargs(self, request, step):
        """Pass autogenerated_fields and edit_mode to forms."""
        return {
            'autogenerated_fields': Project.AUTOGENERATED_FIELDS,
            'edit_mode': True,
        }

    def get_step_context(self, request, step, form):
        """Add extra context for specific steps using model constants."""
        context = {}

        # Environment step - soil and climate descriptions from model
        if step == 1:
            context['soil_descriptions'] = Project.SOIL_TYPE_DESCRIPTIONS
            context['climate_descriptions'] = Project.CLIMATE_DESCRIPTIONS

        # Coordinates step - help text from model
        if step == 3:
            context['coordinate_help'] = Project.COORDINATE_HELP

        # Summary step - choice mappings for display labels
        if step == 5:
            context['project_type_choices'] = Project.PROJECT_TYPE_CHOICES
            context['soil_type_choices'] = Project.SOIL_TYPE_CHOICES
            context['climate_choices'] = Project.CLIMATE_CHOICES

        # Pass edit mode flag to all steps
        context['edit_mode'] = True

        return context

    def _get_update_instance(self, request):
        """Return the project instance for updating."""
        return self.get_project_instance(request)

    @transaction.atomic
    def on_complete(self, request, all_data):
        """
        Override on_complete to update the existing project and related models.

        This is the key method that makes edit mode work properly.
        """
        project = self.get_project_instance(request)
        if not project:
            return {
                'success': False,
                'error': 'Project not found',
            }

        # Update project basic fields (step 0)
        if 'name' in all_data:
            project.name = _clean_value(all_data.get('name')) or project.name
        if 'project_type' in all_data:
            project.project_type = _clean_value(all_data.get('project_type')) or project.project_type
        if 'description' in all_data:
            project.description = _clean_value(all_data.get('description', ''))

        # Update environment fields (step 1)
        if 'soil_type' in all_data:
            project.soil_type = _clean_value(all_data.get('soil_type')) or project.soil_type
        if 'climate' in all_data:
            project.climate = _clean_value(all_data.get('climate')) or project.climate
        # Note: area_hectares is auto-generated, don't update it

        project.save()

        # Update address (step 2)
        if project.address:
            address = project.address
            if 'address_line_1' in all_data:
                address.address_line_1 = _clean_value(all_data.get('address_line_1', ''))
            if 'address_line_2' in all_data:
                address.address_line_2 = _clean_value(all_data.get('address_line_2', ''))
            if 'city' in all_data:
                address.city = _clean_value(all_data.get('city', ''))
            if 'region' in all_data:
                address.region = _clean_value(all_data.get('region', ''))
            if 'postcode' in all_data:
                address.postcode = _clean_value(all_data.get('postcode', ''))
            if 'country_code' in all_data:
                address.country_code = _clean_value(all_data.get('country_code', ''))
            address.save()

        # Update coordinates (step 3)
        if project.coordinates:
            coords = project.coordinates
            if 'latitude' in all_data:
                coords.latitude = _clean_value(all_data.get('latitude'))
            if 'longitude' in all_data:
                coords.longitude = _clean_value(all_data.get('longitude'))
            if 'altitude' in all_data:
                coords.altitude = _clean_value(all_data.get('altitude'))
            if 'elevation' in all_data:
                coords.elevation = _clean_value(all_data.get('elevation'))
            if 'coordinate_system' in all_data:
                coords.coordinate_system = _clean_value(all_data.get('coordinate_system', ''))
            if 'what3w' in all_data:
                coords.what3w = _clean_value(all_data.get('what3w', ''))
            coords.save()

        # Update contact (step 4)
        if project.contact:
            contact = project.contact
            contact_fields = [
                'company_name', 'company_email', 'company_phone',
                'primary_contact_name', 'primary_contact_email', 'primary_contact_phone',
                'land_owner_name', 'land_owner_email', 'land_owner_phone',
                'secondary_contact_name', 'secondary_contact_email', 'secondary_contact_phone',
            ]
            for field in contact_fields:
                if field in all_data:
                    setattr(contact, field, _clean_value(all_data.get(field, '')))
            contact.save()

        # Get redirect URL with slug
        redirect_url = self.success_url.replace('{slug}', project.slug)

        return {
            'success': True,
            'redirect_url': redirect_url,
            'message': self.success_message,
        }


# Register the wizard
register_wizard('project_edit', ProjectEditWizard)


# Export for convenience
__all__ = [
    'ProjectEditWizard',
]
