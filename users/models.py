from django.db import models


# =============================================================================
# USER (Employee accounts in the system)
# =============================================================================
class User(models.Model):
    name = models.CharField(max_length=255, db_index=True)
    email = models.EmailField(max_length=255, unique=True)
    phone = models.CharField(max_length=30, null=True, blank=True)
    pronouns = models.CharField(max_length=20, null=True, blank=True)
    title = models.CharField(max_length=100, null=True, blank=True)
    department = models.CharField(max_length=100, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.name} ({self.email})"
