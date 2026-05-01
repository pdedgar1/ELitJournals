#!/usr/bin/env python3
"""
Fix corrupted accent marks (mojibake) in CSV files.
Converts misencoded characters like √£ back to proper accented characters.
"""

import os
import sys
from pathlib import Path


def fix_mojibake(text):
    """
    Fix mojibake by re-interpreting Latin-1 as UTF-8.
    This happens when UTF-8 text is incorrectly decoded as Latin-1.
    """
    try:
        # Try to re-encode as Latin-1 and decode as UTF-8
        return text.encode('latin-1').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        # If it fails, return original text
        return text


def has_mojibake(text):
    """Check if text likely contains mojibake (corrupted characters)."""
    # Look for patterns like √ followed by special chars, or other encoding artifacts
    mojibake_indicators = ['√', '¬', '¶', '†', '‡', '™']
    return any(indicator in text for indicator in mojibake_indicators)


def scan_files(root_directory):
    """Find all CSV files that may have mojibake."""
    affected_files = []

    for dirpath, dirnames, filenames in os.walk(root_directory):
        for filename in filenames:
            if filename.lower().endswith('.csv'):
                file_path = os.path.join(dirpath, filename)
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                    if has_mojibake(content):
                        affected_files.append(file_path)
                except Exception as e:
                    print(f"Warning: Could not read {file_path}: {e}")

    return affected_files


def show_preview(file_path, original, corrected):
    """Show a preview of what will change in a file."""
    print(f"\n{'='*70}")
    print(f"FILE: {os.path.basename(file_path)}")
    print(f"{'='*70}")

    # Find lines that changed
    original_lines = original.split('\n')
    corrected_lines = corrected.split('\n')

    changes_shown = 0
    for i, (orig_line, corr_line) in enumerate(zip(original_lines, corrected_lines)):
        if orig_line != corr_line and changes_shown < 5:  # Show first 5 changes
            print(f"\nLine {i + 1}:")
            print(f"  BEFORE: {orig_line[:80]}")
            print(f"  AFTER:  {corr_line[:80]}")
            changes_shown += 1

    if len(original_lines) != len(corrected_lines):
        print(f"\nNote: Line count changed from {len(original_lines)} to {len(corrected_lines)}")


def fix_files(root_directory):
    """Main function: scan, preview, and fix files."""
    print(f"Scanning: {root_directory}\n")

    affected_files = scan_files(root_directory)

    if not affected_files:
        print("✓ No files with corrupted characters found.")
        return

    print(f"Found {len(affected_files)} file(s) with potential mojibake:\n")
    for f in affected_files:
        print(f"  - {os.path.relpath(f, root_directory)}")

    # Show previews
    print("\n\nPREVIEW OF CHANGES:")
    for file_path in affected_files[:3]:  # Preview first 3 files
        with open(file_path, 'r', encoding='utf-8') as f:
            original = f.read()
        corrected = fix_mojibake(original)
        show_preview(file_path, original, corrected)

    if len(affected_files) > 3:
        print(f"\n... and {len(affected_files) - 3} more file(s)")

    # Ask for confirmation
    print(f"\n\n{'='*70}")
    response = input(f"Apply fixes to {len(affected_files)} file(s)? (yes/no): ").strip().lower()

    if response != 'yes':
        print("Cancelled.")
        return

    # Apply fixes
    fixed_count = 0
    for file_path in affected_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                original = f.read()
            corrected = fix_mojibake(original)

            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(corrected)

            fixed_count += 1
        except Exception as e:
            print(f"Error fixing {file_path}: {e}")

    print(f"\n✓ Fixed {fixed_count}/{len(affected_files)} files")


def main():
    if len(sys.argv) > 1:
        root_dir = sys.argv[1]
    else:
        root_dir = '.'

    root_dir = os.path.abspath(root_dir)

    if not os.path.isdir(root_dir):
        print(f"Error: '{root_dir}' is not a valid directory")
        return

    fix_files(root_dir)


if __name__ == '__main__':
    main()
