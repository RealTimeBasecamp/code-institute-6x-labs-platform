"""
Wizard registration and discovery module.

This module provides the wizard registry system for centralized
wizard configuration and lookup.
"""
from .registry import register_wizard, get_wizard, wizard_exists, get_all_wizards

__all__ = ['register_wizard', 'get_wizard', 'wizard_exists', 'get_all_wizards']
