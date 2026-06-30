import os
import re

index_path = r'd:\xampp\htdocs\sanjana\seo\seo-social\views\index.ejs'
pages_dir = r'd:\xampp\htdocs\sanjana\seo\seo-social\views\pages'
os.makedirs(pages_dir, exist_ok=True)

with open(index_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    
    # Check if this line starts a page div
    match = re.search(r'<div[^>]*class="[^"]*page[^"]*"[^>]*id="page-([^"]+)"', line)
    if not match:
        match = re.search(r'<div[^>]*id="page-([^"]+)"[^>]*class="[^"]*page[^"]*"', line)

    if match:
        page_name = match.group(1)
        print(f"Extracting {page_name}...")
        
        # Start extracting
        page_lines = [line]
        div_count = line.count('<div') - line.count('</div')
        
        i += 1
        while i < len(lines) and div_count > 0:
            current_line = lines[i]
            page_lines.append(current_line)
            div_count += current_line.count('<div') - current_line.count('</div')
            i += 1
            
        # Write to page file
        page_file_path = os.path.join(pages_dir, f"{page_name}.ejs")
        with open(page_file_path, 'w', encoding='utf-8') as pf:
            pf.writelines(page_lines)
            
        # Add include to new_lines
        indent = re.match(r'^\s*', line).group(0)
        new_lines.append(f"{indent}<%- include('pages/{page_name}') %>\n")
        
        continue # i is already advanced
        
    new_lines.append(line)
    i += 1

# Write updated index.ejs
with open(index_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Extraction complete.")
