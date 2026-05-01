#!/usr/bin/env python3
"""
Extract wiki-style links [[...]] and nodes (file names) from markdown files.
Outputs results to CSV format.
"""

import os
import re
import csv
from pathlib import Path


def extract_links(markdown_content):
    """Extract all [[...]] style links from markdown content."""
    # Pattern matches [[text]] - captures the content inside
    pattern = r'\[\[([^\]]+)\]\]'
    return re.findall(pattern, markdown_content)


def process_markdown_files(root_directory):
    """
    Walk through directory, find all .md files, and extract links.
    Returns list of dictionaries with source_file, link_text, and linked_node.
    """
    results = []

    # Walk through all directories
    for dirpath, dirnames, filenames in os.walk(root_directory):
        for filename in filenames:
            # Only process markdown files
            if filename.lower().endswith('.md'):
                file_path = os.path.join(dirpath, filename)
                relative_path = os.path.relpath(file_path, root_directory)

                # Read the file
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        content = f.read()
                except Exception as e:
                    print(f"Warning: Could not read {file_path}: {e}")
                    continue

                # Extract links
                links = extract_links(content)

                # Add each link as a result
                for link in links:
                    # Try to infer the target file name (remove anchor, path, etc.)
                    # [[link]] might be [[link|display text]] or [[folder/link]]
                    target = link.split('|')[0].strip()  # Remove display text if present
                    target_file = target.split('/')[-1].strip()  # Get last part of path

                    results.append({
                        'source_file': relative_path,
                        'link_text': link,
                        'target_node': target_file,
                        'full_path': file_path
                    })

    return results


def write_csv(results, output_file):
    """Write results to CSV file."""
    if not results:
        print("No links found.")
        return

    fieldnames = ['source_file', 'link_text', 'target_node']

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()

        for result in results:
            writer.writerow({
                'source_file': result['source_file'],
                'link_text': result['link_text'],
                'target_node': result['target_node']
            })

    print(f"✓ Extracted {len(results)} links from markdown files")
    print(f"✓ Results saved to: {output_file}")


def main():
    # Get the directory to scan (current directory or specified)
    import sys

    if len(sys.argv) > 1:
        root_dir = sys.argv[1]
    else:
        root_dir = '.'

    # Expand to absolute path
    root_dir = os.path.abspath(root_dir)

    if not os.path.isdir(root_dir):
        print(f"Error: '{root_dir}' is not a valid directory")
        return

    print(f"Scanning: {root_dir}")

    # Extract links
    results = process_markdown_files(root_dir)

    # Write CSV
    output_path = os.path.join(root_dir, 'extracted_links.csv')
    write_csv(results, output_path)


if __name__ == '__main__':
    main()