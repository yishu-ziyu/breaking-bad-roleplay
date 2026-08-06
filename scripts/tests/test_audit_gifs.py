"""Tests for scripts/audit_gifs.py.

Run with: cd backend && uv run pytest ../scripts/tests/ -q
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import requests

# ---------------------------------------------------------------------------
# Set up mocks for modules imported inside function bodies
# ---------------------------------------------------------------------------

# face_recognition is imported inside load_reference_face() and audit_gif_frame()
_mock_fr = MagicMock()
sys.modules["face_recognition"] = _mock_fr

# Ensure the scripts directory is on sys.path so we can import audit_gifs
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import audit_gifs


# ---------------------------------------------------------------------------
# Helper: create a mock ref-faces directory with known files
# ---------------------------------------------------------------------------


@pytest.fixture
def ref_faces_dir(tmp_path: Path) -> Path:
    """Create a temporary ref-faces directory with a walter.jpg reference."""
    d = tmp_path / "ref-faces"
    d.mkdir()
    (d / "walter.jpg").write_text("fake-image-data")
    return d


# ---------------------------------------------------------------------------
# Fixtures for roleAssets.ts content
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_role_assets_ts(tmp_path: Path) -> Path:
    """Create a minimal roleAssets.ts for testing."""
    content = """
export type RoleAssetCharacterId = 'walter' | 'jesse'

export const roleAssets: Record<RoleAssetCharacterId, RoleAssetRegistryEntry> = {
  walter: {
    characterId: 'walter',
    displayName: 'Walter',
    gifPools: [
      {
        id: 'walter-controlled-glare',
        source: 'giphy',
        url: 'https://media.giphy.com/media/3oFzm9r8nz1CmqYtmU/giphy.gif',
        tags: ['default', 'glare'],
        usageNotes: 'General Walter fallback.',
        safetyNotes: 'fictional roleplay',
        copyrightNotes: 'platform note',
      },
      {
        id: 'walter-chemistry-focus',
        source: 'giphy',
        url: 'https://media.giphy.com/media/R3S6MfUoKvBVS/giphy.gif',
        tags: ['chemistry'],
        usageNotes: 'Chemistry reference.',
        safetyNotes: 'fictional roleplay',
        copyrightNotes: 'platform note',
      },
    ],
  },
  jesse: {
    characterId: 'jesse',
    displayName: 'Jesse',
    gifPools: [
      {
        id: 'jesse-panic-fallback',
        source: 'giphy',
        url: 'https://media.giphy.com/media/u7UgRRotar5du/giphy.gif',
        tags: ['default', 'panic'],
        usageNotes: 'Jesse anxious.',
        safetyNotes: 'fictional roleplay',
        copyrightNotes: 'platform note',
      },
    ],
  },
  marie: {
    characterId: 'marie',
    displayName: 'Marie',
    gifPools: [],
  },
}
"""
    f = tmp_path / "roleAssets.ts"
    f.write_text(content)
    return f


@pytest.fixture
def empty_role_assets_ts(tmp_path: Path) -> Path:
    """Create a roleAssets.ts with no gifPools."""
    content = """
export const roleAssets: Record<string, any> = {}
"""
    f = tmp_path / "roleAssets.ts"
    f.write_text(content)
    return f


# ---------------------------------------------------------------------------
# Tests: parse_role_assets
# ---------------------------------------------------------------------------


class TestParseRoleAssets:
    def test_parses_all_characters_with_gifs(self, sample_role_assets_ts: Path):
        result = audit_gifs.parse_role_assets(str(sample_role_assets_ts))
        assert "walter" in result
        assert "jesse" in result
        assert "marie" in result  # empty pool

    def test_extracts_correct_gif_count(self, sample_role_assets_ts: Path):
        result = audit_gifs.parse_role_assets(str(sample_role_assets_ts))
        assert len(result["walter"]) == 2
        assert len(result["jesse"]) == 1
        assert len(result["marie"]) == 0

    def test_extracts_gif_ids_and_urls(self, sample_role_assets_ts: Path):
        result = audit_gifs.parse_role_assets(str(sample_role_assets_ts))
        walter = result["walter"]
        assert walter[0]["id"] == "walter-controlled-glare"
        assert walter[0]["url"] == "https://media.giphy.com/media/3oFzm9r8nz1CmqYtmU/giphy.gif"
        assert walter[1]["id"] == "walter-chemistry-focus"

    def test_empty_file_returns_empty_dict(self, empty_role_assets_ts: Path):
        result = audit_gifs.parse_role_assets(str(empty_role_assets_ts))
        assert result == {}


# ---------------------------------------------------------------------------
# Tests: _find_matching_bracket
# ---------------------------------------------------------------------------
# NOTE: The function expects `start` to be the position AFTER the opening
# bracket, with depth=1 already counting that opening bracket.


class TestFindMatchingBracket:
    def test_simple_nesting(self):
        text = "abc[def[ghi]jkl]mno"
        # Opening bracket at position 3; start at position 4 (after it)
        pos = audit_gifs._find_matching_bracket(text, 4, "[", "]")
        assert pos is not None
        assert text[3 : pos + 1] == "[def[ghi]jkl]"

    def test_unmatched_returns_none(self):
        text = "abc[def"
        # Opening bracket at position 3; start at position 4
        pos = audit_gifs._find_matching_bracket(text, 4, "[", "]")
        assert pos is None

    def test_skips_string_literals(self):
        text = "abc['[']def]"
        # Opening bracket at position 3; start at position 4 (after '[', before string literal)
        pos = audit_gifs._find_matching_bracket(text, 4, "[", "]")
        assert pos is not None
        # The matching bracket is at position 7 (the ']' right after the string)
        assert text[3 : pos + 1] == "['[']"


# ---------------------------------------------------------------------------
# Tests: extract_first_frame
# ---------------------------------------------------------------------------


class TestExtractFirstFrame:
    @patch("audit_gifs.requests.get")
    def test_download_failure_returns_none(self, mock_get):
        mock_get.side_effect = requests.ConnectionError("Connection error")
        result = audit_gifs.extract_first_frame("https://example.com/test.gif")
        assert result is None

    @patch("audit_gifs.requests.get")
    def test_non_image_content_returns_none(self, mock_get):
        mock_resp = MagicMock()
        mock_resp.content = b"not an image"
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp
        result = audit_gifs.extract_first_frame("https://example.com/test.gif")
        assert result is None

    @patch("audit_gifs.requests.get")
    @patch("audit_gifs.Image.open")
    def test_static_image_returns_rgb(self, mock_open, mock_get):
        mock_resp = MagicMock()
        mock_resp.content = b"fake-image-data"
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        mock_img = MagicMock()
        mock_img.is_animated = False
        mock_img.convert.return_value = mock_img
        mock_open.return_value = mock_img

        result = audit_gifs.extract_first_frame("https://example.com/test.gif")
        assert result is mock_img
        mock_img.convert.assert_called_once_with("RGB")


# ---------------------------------------------------------------------------
# Tests: load_reference_face
# ---------------------------------------------------------------------------


class TestLoadReferenceFace:
    def test_no_reference_file_returns_none(self, ref_faces_dir: Path):
        """REF_FACES_DIR has walter.jpg but not 'nonexistent'."""
        with patch.object(audit_gifs, "REF_FACES_DIR", ref_faces_dir):
            result = audit_gifs.load_reference_face("nonexistent")
            assert result is None

    def test_face_detected_returns_encoding(self, ref_faces_dir: Path):
        """When face_recognition finds an encoding, return it."""
        _mock_fr.reset_mock()
        _mock_fr.load_image_file.return_value = "fake_image_array"
        _mock_fr.face_encodings.return_value = ["encoding1"]

        with patch.object(audit_gifs, "REF_FACES_DIR", ref_faces_dir):
            result = audit_gifs.load_reference_face("walter")
            assert result == "encoding1"
            _mock_fr.load_image_file.assert_called_once()

    def test_no_face_detected_returns_none(self, ref_faces_dir: Path):
        """When face_recognition finds no faces, return None."""
        _mock_fr.reset_mock()
        _mock_fr.load_image_file.return_value = "fake_image_array"
        _mock_fr.face_encodings.return_value = []

        with patch.object(audit_gifs, "REF_FACES_DIR", ref_faces_dir):
            result = audit_gifs.load_reference_face("walter")
            assert result is None


# ---------------------------------------------------------------------------
# Tests: audit_gif_frame
# ---------------------------------------------------------------------------


class TestAuditGifFrame:
    def test_face_match_passes(self):
        """Face distance below threshold passes."""
        _mock_fr.reset_mock()
        _mock_fr.face_locations.return_value = [(0, 100, 100, 0)]  # one face
        _mock_fr.face_encodings.return_value = [["frame_enc"]]
        _mock_fr.face_distance.return_value = [0.23]

        mock_frame = MagicMock()
        result = audit_gifs.audit_gif_frame(
            mock_frame, "ref_enc", "test-gif", "https://example.com/gif.gif", "walter"
        )
        assert result["passed"] is True
        assert result["face_distance"] == 0.23
        assert result["reason"] is None

    def test_face_distance_above_threshold_fails(self):
        """Face distance above threshold fails."""
        _mock_fr.reset_mock()
        _mock_fr.face_locations.return_value = [(0, 100, 100, 0)]
        _mock_fr.face_encodings.return_value = [["frame_enc"]]
        _mock_fr.face_distance.return_value = [0.75]

        mock_frame = MagicMock()
        result = audit_gifs.audit_gif_frame(
            mock_frame, "ref_enc", "test-gif", "https://example.com/gif.gif", "walter"
        )
        assert result["passed"] is False
        assert result["face_distance"] == 0.75
        assert result["reason"] is not None

    def test_no_face_detected_fails(self):
        """No face detected in the frame fails."""
        _mock_fr.reset_mock()
        _mock_fr.face_locations.return_value = []

        mock_frame = MagicMock()
        result = audit_gifs.audit_gif_frame(
            mock_frame, "ref_enc", "test-gif", "https://example.com/gif.gif", "walter"
        )
        assert result["passed"] is False
        assert result["face_distance"] is None
        assert result["reason"] == "no_face_detected"


# ---------------------------------------------------------------------------
# Tests: main (integration-level)
# ---------------------------------------------------------------------------


class TestMain:
    def test_missing_file_returns_error(self, capsys, tmp_path):
        """If roleAssets.ts doesn't exist, main returns 1 with error JSON."""
        with patch.object(audit_gifs, "ROLE_ASSETS_PATH", tmp_path / "nonexistent.ts"):
            exit_code = audit_gifs.main()
            assert exit_code == 1
            captured = capsys.readouterr()
            report = json.loads(captured.out)
            assert "error" in report

    def test_no_reference_faces_reports_all_failed(
        self, sample_role_assets_ts: Path, capsys, tmp_path: Path
    ):
        """When no ref-faces exist, all GIFs should be reported as failed."""
        empty_ref_dir = tmp_path / "empty-ref"
        empty_ref_dir.mkdir()

        with patch.object(audit_gifs, "ROLE_ASSETS_PATH", sample_role_assets_ts):
            with patch.object(audit_gifs, "REF_FACES_DIR", empty_ref_dir):
                exit_code = audit_gifs.main()
                assert exit_code == 1
                captured = capsys.readouterr()
                report = json.loads(captured.out)
                assert report["summary"]["total_gifs"] == 3
                assert report["summary"]["failed"] == 3
                for result in report["results"]:
                    assert result["reason"] == "no_reference_face"

    def test_empty_assets_returns_empty_report(
        self, empty_role_assets_ts: Path, capsys
    ):
        """When roleAssets.ts has no gifPools, report has error."""
        with patch.object(audit_gifs, "ROLE_ASSETS_PATH", empty_role_assets_ts):
            exit_code = audit_gifs.main()
            assert exit_code == 1
            captured = capsys.readouterr()
            report = json.loads(captured.out)
            assert "error" in report