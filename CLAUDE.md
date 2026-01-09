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

## Code Institute Mark Scheme Requirements

This project is assessed against the following learning outcomes and criteria:

### LO1: Agile Methodology and Planning
- **1.1 Front-End Design**: Semantic HTML, WCAG compliance, user-friendly interface, consistent styles, responsive layout
- **1.2 Database**: Configured Django app with at least one custom model, proper ORM usage
- **1.3 Agile Methodology**: Agile tool usage (e.g., GitHub Projects), documented user stories
- **1.4 Code Quality**: Custom Python logic, PEP 8 compliance, meaningful naming, comments/docstrings
- **1.5 Documentation**: UX design process documentation, wireframes, mockups, comprehensive README

### LO2: Data Model and Business Logic
- **2.1 Database Development**: Well-organized schema, proper relationships, migrations for version control
- **2.2 CRUD Functionality**: User-friendly interfaces for all CRUD operations with access controls
- **2.3 User Notifications**: Real-time/near-real-time notifications for data changes
- **2.4 Forms and Validation**: Proper form validation, accessible design, clear error messages

### LO3: Authorization, Authentication, and Permissions
- **3.1 Role-Based Login/Registration**: Secure role-based system with clear user role differentiation
- **3.2 Reflect Login State**: Accurate login state display across all pages, visual indicators
- **3.3 Access Control**: Proper restrictions based on user roles, clear error handling

### LO4: Testing
- **4.1 Python Test Procedures**: Clear test cases, detailed results with pass/fail status
- **4.2 JavaScript Test Procedures**: (if applicable) Test cases with results
- **4.3 Testing Documentation**: Detailed documentation of all testing procedures and results

### LO5: Version Control
- **5.1 Git & GitHub**: Meaningful commit messages, regular commits, comprehensive history
- **5.2 Secure Code Management**: No passwords in repo, use of environment variables and .gitignore

### LO6: Deployment
- **6.1 Deploy to Cloud**: Successful deployment with matching functionality
- **6.2 Document Deployment**: Clear step-by-step deployment documentation
- **6.3 Security in Deployment**: No sensitive data in repo, DEBUG=False in production

### LO7: Object-Based Software Concepts
- **7.1 Custom Data Model**: Design and implement custom models using Django ORM

### LO8: AI Tools Usage
- **8.1 Code Creation**: Brief reflection on AI-assisted code generation
- **8.2 Debugging**: Summary of AI's role in bug identification and resolution
- **8.3 Optimization**: Reflection on AI contributions to performance and UX improvements
- **8.4 Automated Tests**: Documentation of AI role in creating unit tests
- **8.5 Workflow Impact**: Insights into how AI influenced development workflow

### Final Project Requirements Checklist
- [ ] At least 1 original custom model (different from walkthrough projects)
- [ ] At least 1 form on frontend for CRUD functionality (without admin panel)
- [ ] At least 1 UI element for deleting records (without admin panel)
- [ ] Evidence of Agile methodologies in GitHub repository
- [ ] DEBUG mode set to False
- [ ] Working user registration, login, and logout functionality
- [ ] Detailed testing documentation beyond validation tool results