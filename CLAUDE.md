# CLAUDE.md

Project-specific instructions for Claude Code.

## Django Conventions

Always use Django best practices and conventions for:

- **Paths**: Use `settings.BASE_DIR` for file paths, never `Path(__file__).resolve().parent.parent...`
- **File locations**: Follow Django's app structure (models.py, views.py, urls.py, admin.py, etc.)
- **Naming**: Use Django naming conventions (snake_case for functions/variables, PascalCase for classes)
- **User authentication**: Use Django's built-in auth system, `AbstractUser` for custom user models
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