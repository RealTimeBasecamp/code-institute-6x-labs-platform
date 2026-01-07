# CLAUDE.md

Project-specific instructions for Claude Code.

## Django Conventions

Always use Django best practices and conventions for:

- **Paths**: Use `settings.BASE_DIR` for file paths, never `Path(__file__).resolve().parent.parent...`
- **File locations**: Follow Django's app structure (models.py, views.py, urls.py, admin.py, etc.)
- **Naming**: Use Django naming conventions (snake_case for functions/variables, PascalCase for classes)
- **User authentication**: Use django-allauth for authentication (social auth, email verification, password reset)
- **Security**: Follow Django security best practices (CSRF, XSS protection, SQL injection prevention)
- **Logic**: Use Django ORM, class-based views where appropriate, template inheritance
- **Structure**: Keep apps focused and reusable, use `core` app for shared models

## Project Structure

- `core/` - Shared models (SubscriptionTier, NavigationItem, etc.) and utilities
- `users/` - Custom User model extending AbstractUser
- `projects/` - Project management features
- `saas_platform/` - Django project settings and root URL config

## Data Loading

Seed data (subscription tiers, navigation items) is loaded via management commands:
```bash
python manage.py load_navigation_data
```

Data is stored in JSON files under `core/data/` and loaded using `settings.BASE_DIR` paths.

## URL Routing

Request flow: `URL request → saas_platform/urls.py (routes to app) → core/urls.py (routes to view) → core/views.py (renders template)`

## Authentication

This project uses **django-allauth** for authentication:
- Social login (Google, Apple)
- Email/password authentication
- Email verification and password reset flows
- Works with the custom User model in `users/`

## Security

**CRITICAL**: Always prioritize security when working with:
- User authentication and sessions
- Password handling and storage
- User data and personal information
- Subscription/payment data
- API endpoints and permissions
- Form inputs and data validation

Never expose sensitive data in templates, logs, or error messages. Always validate and sanitize user input. Use Django's built-in protections (CSRF, XSS, SQL injection prevention).