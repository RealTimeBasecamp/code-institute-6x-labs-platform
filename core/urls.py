from django.urls import path
from . import views
from . import wizard_api

app_name = 'core'

urlpatterns = [
    path('', views.login_view, name='login'),
    path('dashboard/', views.dashboard, name='dashboard'),

    # User preferences API
    path(
        'api/user-preferences/',
        views.user_preferences_api,
        name='user_preferences_api',
    ),

    # # State Management API
    # path(
    #     'api/state/publish/',
    #     state_api.publish_changes,
    #     name='state_publish'
    # ),

    # Wizard API endpoints
    path(
        'api/wizard/<str:wizard_name>/start/',
        wizard_api.wizard_dispatch,
        {'action': 'start'},
        name='wizard_start'
    ),
    path(
        'api/wizard/<str:wizard_name>/step/<int:step>/',
        wizard_api.wizard_dispatch,
        {'action': 'step'},
        name='wizard_step'
    ),
    path(
        'api/wizard/<str:wizard_name>/validate/',
        wizard_api.wizard_dispatch,
        {'action': 'validate'},
        name='wizard_validate'
    ),
    path(
        'api/wizard/<str:wizard_name>/submit/',
        wizard_api.wizard_dispatch,
        {'action': 'submit'},
        name='wizard_submit'
    ),
    path(
        'api/wizard/<str:wizard_name>/cancel/',
        wizard_api.wizard_dispatch,
        {'action': 'cancel'},
        name='wizard_cancel'
    ),
]
