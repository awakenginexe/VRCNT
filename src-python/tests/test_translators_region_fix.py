"""
Regression tests for translators_default_region environment variable behavior.

The translators package performs automatic server-region detection on import,
which fails in some environments without network access. VRCNT must set
translators_default_region=EN as a default before importing the package,
while preserving any explicitly configured value (e.g., CN).
"""
import os
import sys
import unittest
from pathlib import Path

# Add src-python to Python path so imports work from tests directory
TESTS_DIR = Path(__file__).resolve().parent
SRC_PYTHON_DIR = TESTS_DIR.parent
if str(SRC_PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_PYTHON_DIR))

from models.translation.translation_translator import _getWebTranslator


class TranslatorsDefaultRegionRegressionTest(unittest.TestCase):
    """Test that translators_default_region is set correctly at import boundary."""

    def setUp(self):
        """Save and clear any existing env var for clean testing."""
        self.original_region = os.environ.pop("translators_default_region", None)
        # Remove translators from sys.modules to force re-import for each test
        # This ensures fresh behavior is tested, not cached state
        self._original_translators = sys.modules.pop("translators", None)

    def tearDown(self):
        """Restore original env var and module state."""
        if self.original_region is not None:
            os.environ["translators_default_region"] = self.original_region
        elif "translators_default_region" in os.environ:
            del os.environ["translators_default_region"]
        # Restore translators module if it existed
        if self._original_translators is not None:
            sys.modules["translators"] = self._original_translators
        elif "translators" in sys.modules:
            del sys.modules["translators"]

    def test_sets_default_en_when_env_var_absent(self):
        """Test that EN default is set when translators_default_region is absent."""
        # Ensure env var is not present
        if "translators_default_region" in os.environ:
            del os.environ["translators_default_region"]

        # Call _getWebTranslator to trigger the import
        result = _getWebTranslator()

        # The environment variable should now be set to EN
        self.assertEqual(
            os.environ.get("translators_default_region"),
            "EN",
            "translators_default_region should be set to EN when absent"
        )
        
        # The function should have been retrieved (even if it failed, the env var should be set)
        # Note: result may be None if import fails, but env var should still be set

    def test_preserves_existing_cn_value(self):
        """Test that an existing CN value is NOT overwritten."""
        # Set CN explicitly
        os.environ["translators_default_region"] = "CN"

        # Call _getWebTranslator
        result = _getWebTranslator()

        # The environment variable should remain CN
        self.assertEqual(
            os.environ.get("translators_default_region"),
            "CN",
            "translators_default_region should NOT be overwritten when already set to CN"
        )

    def test_preserves_existing_en_value(self):
        """Test that an existing EN value is NOT overwritten (though it's the same)."""
        # Set EN explicitly
        os.environ["translators_default_region"] = "EN"

        # Call _getWebTranslator
        result = _getWebTranslator()

        # Should remain EN
        self.assertEqual(
            os.environ.get("translators_default_region"),
            "EN",
            "translators_default_region should remain EN"
        )

    def test_preserves_arbitrary_custom_value(self):
        """Test that arbitrary custom values (like 'US') are preserved."""
        # Set an arbitrary custom value
        os.environ["translators_default_region"] = "US"

        # Call _getWebTranslator
        result = _getWebTranslator()

        # Should remain US
        self.assertEqual(
            os.environ.get("translators_default_region"),
            "US",
            "translators_default_region should preserve custom values like US"
        )

    def test_multiple_calls_dont_duplicate(self):
        """Test that multiple calls don't cause issues."""
        # First call with no env var
        if "translators_default_region" in os.environ:
            del os.environ["translators_default_region"]
        
        _getWebTranslator()
        self.assertEqual(os.environ.get("translators_default_region"), "EN")
        
        # Second call should not change anything
        _getWebTranslator()
        self.assertEqual(os.environ.get("translators_default_region"), "EN")
        
        # Third call with manual override
        os.environ["translators_default_region"] = "CN"
        _getWebTranslator()
        self.assertEqual(os.environ.get("translators_default_region"), "CN")


if __name__ == "__main__":
    unittest.main()
