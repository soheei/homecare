import zipfile
from pathlib import Path
from xml.dom import Node, minidom

SOURCE = Path("output/최종 데모용_발표 보강본.pptx")
REDESIGN = Path(".ppt-build/i2-i3-scenario-revision.pptx")
OUTPUT = Path(".ppt-build/candidate-i2-i3-scenario-revision.pptx")


def parse(data: bytes):
    assert b"<!DOCTYPE" not in data and b"<!ENTITY" not in data
    return minidom.parseString(data)


def element_children(node):
    return [child for child in node.childNodes if child.nodeType == Node.ELEMENT_NODE]


with zipfile.ZipFile(SOURCE) as src_zip, zipfile.ZipFile(REDESIGN) as design_zip:
    files = {name: src_zip.read(name) for name in src_zip.namelist()}

    # Display positions 4 and 5 resolve to physical slide19.xml and slide20.xml.
    for target_no, design_no in ((19, 1), (20, 2)):
        target_path = f"ppt/slides/slide{target_no}.xml"
        target_doc = parse(files[target_path])
        target_tree = target_doc.getElementsByTagName("p:spTree")[0]

        design_doc = parse(design_zip.read(f"ppt/slides/slide{design_no}.xml"))
        design_tree = design_doc.getElementsByTagName("p:spTree")[0]

        for child in list(element_children(target_tree))[2:]:
            target_tree.removeChild(child)
        for child in element_children(design_tree)[2:]:
            target_tree.appendChild(target_doc.importNode(child, True))

        for index, node in enumerate(target_tree.getElementsByTagName("p:cNvPr"), 1):
            node.setAttribute("id", str(index))

        files[target_path] = target_doc.toxml(encoding="utf-8")

        # Retain the target deck's notes relationship while replacing its text.
        target_notes = f"ppt/notesSlides/notesSlide{target_no}.xml"
        design_notes = parse(design_zip.read(f"ppt/notesSlides/notesSlide{design_no}.xml"))
        target_notes_doc = parse(files[target_notes])
        target_body = target_notes_doc.getElementsByTagName("p:spTree")[0]
        design_body = design_notes.getElementsByTagName("p:spTree")[0]
        for child in list(element_children(target_body))[2:]:
            target_body.removeChild(child)
        for child in element_children(design_body)[2:]:
            target_body.appendChild(target_notes_doc.importNode(child, True))
        files[target_notes] = target_notes_doc.toxml(encoding="utf-8")

with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as out_zip:
    for name, data in files.items():
        out_zip.writestr(name, data)

print(f"Wrote {OUTPUT}")

