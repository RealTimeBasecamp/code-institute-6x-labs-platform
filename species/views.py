from os import name
from django.shortcuts import get_object_or_404, render
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.urls import reverse
from planting.models import Species
from django.views.generic import ListView


class SpeciesListView(LoginRequiredMixin, ListView):
    """
    View to list all species. Accessible at path 'species/', named 'species_list'.
    """
    model = Species
    template_name = 'species/species_list.html'
    context_object_name = 'species_list'
    paginate_by = 20

    def get_queryset(self):
        return Species.objects.all().order_by('common_name')


@login_required
def species_detail(request, common_name):
    """
    Per-species detail view. Accessible at path 'species/<name>/', named 'species_detail'.
    Only accessible to logged-in users.
    """
    species = get_object_or_404(Species, common_name=common_name)
    context = {
        'species': species,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
        ]
    }

    # Build breadcrumbs for this page
    context['breadcrumbs'].append({
        'label': species.common_name,
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })

    return render(request, 'species/species_detail.html', context)


@login_required
def species_mix_list(request):
    """
    Per-species mix view. Accessible at path 'species-mixer/', named 'species_mix'.
    Only accessible to logged-in users.
    """
    # TODO
    # Update with Species mix - CURRENT PLACEHOLDER
    species_mix_list = Species.objects.all()  # Placeholder for actual SpeciesMix model
    context = {
        'species_mix_list': species_mix_list,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            }
        ]
    }

    # Add current page breadcrumb
    context['breadcrumbs'].append({
        'label': 'Mixer',
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })

    return render(request, 'species/species_mixer.html', context)


@login_required
def species_mix(request, mix_name):
    # TODO - Update with Species mix - CURRENT PLACEHOLDER
    species = get_object_or_404(Species, common_name=mix_name)
    species_mix_list = Species.objects.all()  # Placeholder for actual SpeciesMix model

    context = {
        'species': species,
        'species_mix_list': species_mix_list,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
            {
                'label': species.name,
                'url': reverse('species:species_detail', args=[species.name]),
                'is_current': False,
                'is_ellipsis': False,
            },
        ]
    }

    # Add current page breadcrumb
    context['breadcrumbs'].append({
        'label': f'{species.name} Mix',
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })

    return render(request, 'species/species_mix_list.html', context)