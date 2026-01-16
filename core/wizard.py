"""
Multi-step wizard base view for AJAX-based modal forms.

This module provides a reusable base class for implementing multi-step
wizards with session persistence, per-step validation, and automatic
object creation from form models.

Usage (minimal - just list forms):
    from core.wizard import BaseWizardView
    from .forms import BasicInfoForm, AddressForm, ContactForm

    class ProjectWizard(BaseWizardView):
        wizard_name = 'project_creation'
        forms = [BasicInfoForm, AddressForm, ContactForm]

Usage (with customization):
    class ProjectWizard(BaseWizardView):
        wizard_name = 'project_creation'
        forms = [BasicInfoForm, AddressForm, ContactForm]
        success_url = '/projects/'
        success_message = 'Project created!'
        
        # Optional: override context for specific steps
        def get_step_context(self, request, step, form):
            if step == 1:
                return {'soil_types': SOIL_DESCRIPTIONS}
            return {}
"""
import json
import re
from abc import ABC
from datetime import datetime
from decimal import Decimal

from django.db import models, transaction
from django.http import JsonResponse
from django.template.loader import render_to_string
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_protect
from django.utils.decorators import method_decorator


def serialize_form_data(data):
    """
    Serialize form cleaned_data to JSON-compatible format.

    Converts Decimal objects to strings to ensure session serialization works.

    Args:
        data: Dict of form cleaned_data

    Returns:
        dict: JSON-serializable dict
    """
    serialized = {}
    for key, value in data.items():
        if isinstance(value, Decimal):
            serialized[key] = str(value)
        elif value is None:
            serialized[key] = None
        else:
            serialized[key] = value
    return serialized


def _get_app_label(form_class):
    """
    Get app label from form class module path.
    
    Uses the form's module to determine the app, not the model's app.
    This ensures forms in 'projects.forms' use 'projects' templates
    even if they reference models from 'core' app.
    
    Example: 'projects.forms.coordinates' -> 'projects'
    """
    module = form_class.__module__
    return module.split('.')[0]


def _class_name_to_snake(name):
    """
    Convert CamelCase to snake_case.
    
    Examples:
        'BasicInfo' -> 'basic_info'
        'WorkInfo' -> 'work_info'
    """
    # Insert underscore before uppercase letters, then lowercase
    s1 = re.sub(r'(.)([A-Z][a-z]+)', r'\1_\2', name)
    return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()


def _extract_step_name(form_class):
    """
    Extract step name from form class name by removing app prefix and 'Form' suffix.
    
    Uses the app label to dynamically determine what prefix to strip.
    
    Examples:
        ProjectBasicInfoForm (app='projects') -> 'basic_info'
        UserContactForm (app='users') -> 'contact'
        MyCustomStepForm (app='myapp') -> 'custom_step' (strips 'My')
    """
    name = form_class.__name__
    
    # Remove 'Form' suffix
    if name.endswith('Form'):
        name = name[:-4]
    
    # Get app label and derive likely prefix (e.g., 'projects' -> 'Project')
    app_label = _get_app_label(form_class)
    # Singularize and title case: 'projects' -> 'Project', 'users' -> 'User'
    likely_prefix = app_label.rstrip('s').title()
    
    # Remove prefix if present
    if name.startswith(likely_prefix):
        name = name[len(likely_prefix):]
    
    return _class_name_to_snake(name)


def _title_from_class_name(form_class):
    """
    Generate a human-readable title from a form class name.
    
    Examples:
        ProjectBasicInfoForm -> 'Basic Info'
        UserContactForm -> 'Contact'
        ProjectEnvironmentForm -> 'Environment'
    """
    step_name = _extract_step_name(form_class)
    # Convert snake_case to Title Case
    return step_name.replace('_', ' ').title()


def _template_from_class_name(form_class):
    """
    Auto-generate template path from form class.
    
    Convention: {app_label}/wizard_steps/{step_name}.html
    
    Examples:
        ProjectBasicInfoForm -> 'projects/wizard_steps/basic_info.html'
        UserContactForm -> 'users/wizard_steps/contact.html'
    """
    app_label = _get_app_label(form_class)
    step_name = _extract_step_name(form_class)
    return f'{app_label}/wizard_steps/{step_name}.html'


def _get_form_title(form_class):
    """Get title from form class - either explicit or auto-generated."""
    return getattr(form_class, 'title', None) or _title_from_class_name(form_class)


def _get_form_template(form_class):
    """Get template path from form class - either explicit or auto-generated."""
    return getattr(form_class, 'template', None) or _template_from_class_name(form_class)


def _clean_value(value):
    """Convert empty strings to None for database storage."""
    if value == '':
        return None
    return value


def _all_fields_empty(data, fields):
    """Check if all specified fields are empty/None in data."""
    for field in fields:
        value = _clean_value(data.get(field))
        if value is not None:
            return False
    return True


@method_decorator(csrf_protect, name='dispatch')
class BaseWizardView(View, ABC):
    """
    Base class for multi-step modal wizards with automatic object creation.

    Minimal setup - just define forms list:
        class MyWizard(BaseWizardView):
            wizard_name = 'my_wizard'
            forms = [Form1, Form2, Form3]

    The wizard automatically:
    - Generates step titles from form class names (or uses Form.title)
    - Uses a shared template (or uses Form.template for custom)
    - Creates model objects from form Meta.model on completion
    - Links ForeignKeys between created objects
    - Skips optional models when all fields are empty

    Attributes:
        wizard_name (str): Unique identifier used for session key
        forms (list): List of Form classes, one per step
        mode (str): 'create' for new objects, 'update' for existing
        success_url (str): Redirect URL after completion
        success_message (str): Message shown after completion
        session_timeout (int): Session data timeout in seconds
    """

    wizard_name = None
    forms = []
    mode = 'create'  # 'create' or 'update'
    success_url = '/dashboard/'
    success_message = 'Completed successfully!'
    session_timeout = 1800  # 30 minutes

    @property
    def session_key(self):
        """Generate the session storage key for this wizard."""
        return f'wizard_{self.wizard_name}_data'

    @property
    def total_steps(self):
        """Return the total number of steps in the wizard."""
        return len(self.forms)

    @property
    def step_titles(self):
        """Return list of all step titles for the wizard."""
        return [self.get_step_title(i) for i in range(self.total_steps)]

    def get_step_title(self, step):
        """Get title for a step - from form attribute or auto-generated from class name."""
        return _get_form_title(self.forms[step])

    def get_step_template(self, step):
        """Get template for a step - from form attribute or auto-generated from class name."""
        return _get_form_template(self.forms[step])

    def get_wizard_data(self, request):
        """
        Retrieve wizard data from session, or initialize if new.

        Checks for session timeout and clears stale data.

        Args:
            request: HTTP request object

        Returns:
            dict: Wizard session data
        """
        data = request.session.get(self.session_key)

        if data:
            # Check for timeout
            last_modified = datetime.fromisoformat(data.get('last_modified', ''))
            if (timezone.now() - last_modified).total_seconds() > self.session_timeout:
                self.clear_wizard_data(request)
                data = None

        if not data:
            # Initialize new wizard session
            data = {
                'current_step': 0,
                'completed_steps': [],
                'step_data': {},
                'started_at': timezone.now().isoformat(),
                'last_modified': timezone.now().isoformat(),
            }
            self.save_wizard_data(request, data)

        return data

    def save_wizard_data(self, request, data):
        """Save wizard data to session."""
        data['last_modified'] = timezone.now().isoformat()
        request.session[self.session_key] = data
        request.session.modified = True

    def clear_wizard_data(self, request):
        """Clear wizard data from session."""
        if self.session_key in request.session:
            del request.session[self.session_key]
            request.session.modified = True

    def get_initial_data(self, request):
        """
        Override to pre-populate form fields.

        Returns:
            dict: Step index (as string) mapped to field data dicts.
                  Example: {'0': {'first_name': 'John'}}
        """
        return {}

    def get_step_context(self, request, step, form):
        """
        Override to add extra context for a step template.

        Args:
            request: HTTP request object
            step: Current step index (0-based)
            form: Form instance for the current step

        Returns:
            dict: Additional context variables
        """
        return {}

    def get_context_data(self, request, step, form):
        """
        Get context data for a step template.

        Delegates to get_step_context for backwards compatibility.
        Subclasses can override either method.

        Args:
            request: HTTP request object
            step: Current step index (0-based)
            form: Form instance for the current step

        Returns:
            dict: Additional context variables
        """
        return self.get_step_context(request, step, form)

    def dispatch(self, request, *args, **kwargs):
        """Route requests to appropriate handler based on action parameter."""
        if request.method != 'POST':
            return JsonResponse({
                'success': False,
                'error': 'Only POST requests are allowed'
            }, status=405)

        if not request.user.is_authenticated:
            return JsonResponse({
                'success': False,
                'error': 'Authentication required'
            }, status=401)

        action = kwargs.get('action', 'start')
        handlers = {
            'start': self.handle_start,
            'step': self.handle_step,
            'validate': self.handle_validate,
            'submit': self.handle_submit,
            'cancel': self.handle_cancel,
        }

        handler = handlers.get(action)
        if not handler:
            return JsonResponse({
                'success': False,
                'error': f'Unknown action: {action}'
            }, status=400)

        return handler(request, *args, **kwargs)

    def handle_start(self, request, *args, **kwargs):
        """Initialize or resume a wizard session."""
        self.clear_wizard_data(request)
        wizard_data = self.get_wizard_data(request)

        initial_data = self.get_initial_data(request)
        if initial_data:
            wizard_data['step_data'] = initial_data
            self.save_wizard_data(request, wizard_data)

        return self._render_step(request, 0, wizard_data)

    def handle_step(self, request, *args, **kwargs):
        """Load a specific step."""
        step = kwargs.get('step', 0)

        if step < 0 or step >= self.total_steps:
            return JsonResponse({
                'success': False,
                'error': f'Invalid step: {step}'
            }, status=400)

        wizard_data = self.get_wizard_data(request)
        wizard_data['current_step'] = step
        self.save_wizard_data(request, wizard_data)

        return self._render_step(request, step, wizard_data)

    def handle_validate(self, request, *args, **kwargs):
        """Validate current step data."""
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'error': 'Invalid JSON body'
            }, status=400)

        step = body.get('step', 0)
        form_data = body.get('data', {})

        if step < 0 or step >= self.total_steps:
            return JsonResponse({
                'success': False,
                'error': f'Invalid step: {step}'
            }, status=400)

        form_class = self.forms[step]
        form = form_class(data=form_data)

        if form.is_valid():
            wizard_data = self.get_wizard_data(request)
            wizard_data['step_data'][str(step)] = serialize_form_data(
                form.cleaned_data
            )
            if step not in wizard_data['completed_steps']:
                wizard_data['completed_steps'].append(step)
            self.save_wizard_data(request, wizard_data)

            return JsonResponse({
                'success': True,
                'step': step,
                'message': 'Step validated successfully'
            })
        else:
            if hasattr(form, 'get_errors_json'):
                errors = form.get_errors_json()
            else:
                errors = dict(form.errors)
            return JsonResponse({
                'success': False,
                'errors': errors,
                'field_errors': True
            })

    def handle_submit(self, request, *args, **kwargs):
        """Submit the completed wizard."""
        try:
            body = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({
                'success': False,
                'error': 'Invalid JSON body'
            }, status=400)

        wizard_data = self.get_wizard_data(request)

        # Merge all step data
        all_data = {}
        for step_idx, step_data in wizard_data.get('step_data', {}).items():
            if isinstance(step_data, dict):
                all_data.update(step_data)

        final_data = body.get('all_data', {})
        if isinstance(final_data, dict):
            all_data.update(final_data)

        try:
            result = self.on_complete(request, all_data)
            if result.get('success'):
                self.clear_wizard_data(request)
            return JsonResponse(result)
        except Exception as e:
            return JsonResponse({
                'success': False,
                'error': str(e)
            }, status=500)

    def handle_cancel(self, request, *args, **kwargs):
        """Cancel the wizard and clear session data."""
        self.clear_wizard_data(request)
        return JsonResponse({
            'success': True,
            'message': 'Wizard cancelled'
        })

    def _render_step(self, request, step, wizard_data):
        """Render a step template with form and context."""
        form_class = self.forms[step]
        saved_data = wizard_data.get('step_data', {}).get(str(step), {})
        form = form_class(initial=saved_data)

        template_path = self.get_step_template(step)
        step_title = self.get_step_title(step)

        context = {
            'form': form,
            'step': step,
            'total_steps': self.total_steps,
            'step_title': step_title,
            'is_first_step': step == 0,
            'is_last_step': step == self.total_steps - 1,
            'wizard_name': self.wizard_name,
        }

        # Add custom context (supports both method names)
        context.update(self.get_context_data(request, step, form))

        html = render_to_string(template_path, context, request=request)
        is_skippable = self._is_step_skippable(form)

        return JsonResponse({
            'success': True,
            'step': step,
            'html': html,
            'is_skippable': is_skippable,
            'step_titles': self.step_titles,  # Full list for JS to render indicators
            'progress': {
                'current': step,
                'total': self.total_steps,
                'percentage': int((step / self.total_steps) * 100),
                'title': step_title,
            }
        })

    def _is_step_skippable(self, form):
        """Check if a step can be skipped (all fields are optional)."""
        for field in form.fields.values():
            if field.required:
                return False
        return True

    # =========================================================================
    # AUTOMATIC OBJECT CREATION
    # =========================================================================

    @transaction.atomic
    def on_complete(self, request, all_data):
        """
        Automatically create objects from form models.

        Analyzes each form's Meta.model, creates objects, and links
        ForeignKeys automatically. Override for custom behavior.

        Args:
            request: HTTP request object
            all_data: Dict containing merged data from all steps

        Returns:
            dict: Success response with redirect URL and message
        """
        if self.mode == 'update':
            return self._update_existing(request, all_data)
        return self._create_objects(request, all_data)

    def get_extra_create_data(self, request):
        """
        Return extra data to include when creating the main model.
        
        Override in subclasses to add fields not captured by forms,
        such as created_by=request.user.
        
        Args:
            request: HTTP request object
            
        Returns:
            dict: Extra field values to include in main model creation
        """
        return {}

    def _create_objects(self, request, all_data):
        """Create new objects from form data."""
        # Group fields by their source model, track which fields came from forms
        model_data = {}  # model_class -> {field: value}
        model_form_fields = {}  # model_class -> [field_names from forms]
        model_order = []  # Track order forms appear

        for form_class in self.forms:
            meta = getattr(form_class, 'Meta', None)
            if not meta or not hasattr(meta, 'model'):
                continue

            model = meta.model
            fields = getattr(meta, 'fields', [])

            if model not in model_data:
                model_data[model] = {}
                model_form_fields[model] = []
                model_order.append(model)

            # Track which fields this form contributes
            model_form_fields[model].extend(fields)

            # Collect field values
            for field_name in fields:
                if field_name in all_data:
                    model_data[model][field_name] = _clean_value(all_data[field_name])

        # Determine main model (the one with FKs to others)
        main_model = self._detect_main_model(model_order)

        # Check which FKs on main model are nullable (optional)
        nullable_fk_models = set()
        if main_model:
            for field in main_model._meta.get_fields():
                if isinstance(field, models.ForeignKey):
                    if field.null:  # FK is nullable
                        nullable_fk_models.add(field.related_model)

        # Create dependency models first (non-main models)
        created_objects = {}  # model -> instance

        for model in model_order:
            if model == main_model:
                continue  # Skip main model for now

            data = model_data[model]
            form_fields = model_form_fields[model]

            # Skip if ALL form fields are empty AND the FK to this model is nullable
            if _all_fields_empty(all_data, form_fields):
                if model in nullable_fk_models:
                    continue  # Safe to skip - FK is optional

            # Create the dependency object
            instance = model.objects.create(**data)
            created_objects[model] = instance

        # Now create main model with FK references
        if main_model and main_model in model_data:
            data = model_data[main_model].copy()

            # Add FK references to created dependency objects
            for field in main_model._meta.get_fields():
                if isinstance(field, models.ForeignKey):
                    related_model = field.related_model
                    if related_model in created_objects:
                        data[field.name] = created_objects[related_model]

            # Add extra data from subclass (e.g., created_by=request.user)
            extra_data = self.get_extra_create_data(request)
            data.update(extra_data)

            # Create main model with all data + FK references
            main_instance = main_model.objects.create(**data)
            created_objects[main_model] = main_instance

        # Get redirect URL
        redirect_url = self._get_success_url(request, created_objects, main_model)

        return {
            'success': True,
            'redirect_url': redirect_url,
            'message': self.success_message,
        }

    def _update_existing(self, request, all_data):
        """Update existing object (for profile-style wizards)."""
        # Default: update request.user
        instance = self._get_update_instance(request)

        for field_name, value in all_data.items():
            if hasattr(instance, field_name):
                setattr(instance, field_name, _clean_value(value) or getattr(instance, field_name))

        instance.save()

        return {
            'success': True,
            'redirect_url': self.success_url,
            'message': self.success_message,
        }

    def _get_update_instance(self, request):
        """Get the instance to update. Override for custom behavior."""
        return request.user

    def _detect_main_model(self, model_order):
        """
        Detect which model is the 'main' one (has FKs to others).

        The main model is typically the one that references other models
        via ForeignKey fields.
        """
        if not model_order:
            return None

        # Check each model for FK fields pointing to other models in our list
        for model in reversed(model_order):
            for field in model._meta.get_fields():
                if isinstance(field, models.ForeignKey):
                    if field.related_model in model_order:
                        return model

        # Default to last model
        return model_order[-1] if model_order else None

    def _link_foreign_keys(self, main_instance, created_objects):
        """Link ForeignKey fields on main instance to created objects."""
        for field in main_instance._meta.get_fields():
            if isinstance(field, models.ForeignKey):
                related_model = field.related_model
                if related_model in created_objects:
                    setattr(main_instance, field.name, created_objects[related_model])

    def _get_success_url(self, request, created_objects, main_model):
        """Get redirect URL after successful creation."""
        if main_model and main_model in created_objects:
            instance = created_objects[main_model]
            if hasattr(instance, 'slug'):
                return self.success_url.replace('{slug}', instance.slug)
            if hasattr(instance, 'pk'):
                return self.success_url.replace('{pk}', str(instance.pk))
        return self.success_url
