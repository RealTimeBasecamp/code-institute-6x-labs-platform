release: python manage.py migrate && python manage.py collectstatic --noinput && python manage.py load_navigation_data
web: gunicorn saas_platform.wsgi