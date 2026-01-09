from django.shortcuts import render

app_name = 'core'


# Create your views here.
def login_view(request):
    return render(request, 'core/login.html')


def sign_up_view(request):
    return render(request, 'core/sign_up.html')


def dashboard_view(request):
    return render(request, 'core/dashboard.html')