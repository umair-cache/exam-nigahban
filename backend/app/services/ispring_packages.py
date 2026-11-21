from __future__ import annotations

import hashlib
import io
import posixpath
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from xml.etree import ElementTree


MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024
MAX_ARCHIVE_FILES = 5000
BLOCKED_EXTENSIONS = {
    ".exe",
    ".dll",
    ".com",
    ".bat",
    ".cmd",
    ".ps1",
    ".sh",
    ".php",
    ".py",
    ".rb",
    ".jar",
}


class IspringPackageValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedPackage:
    archive_bytes: bytes
    launch_file: str
    checksum_sha256: str


def _safe_member_name(name: str) -> str:
    normalized = name.replace("\\", "/").lstrip("./")
    path = PurePosixPath(normalized)
    if not normalized or path.is_absolute() or ".." in path.parts:
        raise IspringPackageValidationError("The ZIP contains an unsafe file path")
    if path.suffix.lower() in BLOCKED_EXTENSIONS:
        raise IspringPackageValidationError(
            f"The ZIP contains a prohibited file type: {path.suffix.lower()}"
        )
    return str(path)


def validate_scorm_package(archive_bytes: bytes) -> ValidatedPackage:
    if not archive_bytes:
        raise IspringPackageValidationError("The uploaded ZIP is empty")
    if len(archive_bytes) > MAX_ARCHIVE_BYTES:
        raise IspringPackageValidationError("The ZIP exceeds the 50 MB upload limit")

    try:
        archive = zipfile.ZipFile(io.BytesIO(archive_bytes))
    except zipfile.BadZipFile as exc:
        raise IspringPackageValidationError("The uploaded file is not a valid ZIP") from exc

    with archive:
        members = archive.infolist()
        if len(members) > MAX_ARCHIVE_FILES:
            raise IspringPackageValidationError("The ZIP contains too many files")
        if sum(member.file_size for member in members) > MAX_UNCOMPRESSED_BYTES:
            raise IspringPackageValidationError(
                "The uncompressed package exceeds the 200 MB safety limit"
            )

        safe_names: dict[str, str] = {}
        for member in members:
            if member.flag_bits & 0x1:
                raise IspringPackageValidationError("Encrypted ZIP files are not supported")
            if member.file_size > MAX_SINGLE_FILE_BYTES:
                raise IspringPackageValidationError(
                    "A file inside the ZIP exceeds the 50 MB safety limit"
                )
            safe = _safe_member_name(member.filename)
            safe_names[safe.lower()] = member.filename

        manifest_member = safe_names.get("imsmanifest.xml")
        if manifest_member is None:
            raise IspringPackageValidationError(
                "imsmanifest.xml must be present at the root of the SCORM ZIP"
            )

        try:
            manifest_root = ElementTree.fromstring(archive.read(manifest_member))
        except ElementTree.ParseError as exc:
            raise IspringPackageValidationError("The SCORM manifest is invalid XML") from exc

        launch_file = None
        for element in manifest_root.iter():
            if element.tag.rsplit("}", 1)[-1] != "resource":
                continue
            href = element.attrib.get("href")
            scorm_type = next(
                (
                    value
                    for key, value in element.attrib.items()
                    if key.rsplit("}", 1)[-1].lower() == "scormtype"
                ),
                "",
            )
            if href and scorm_type.lower() == "sco":
                launch_file = _safe_member_name(href.split("?", 1)[0].split("#", 1)[0])
                break

        if launch_file is None:
            raise IspringPackageValidationError(
                "No launchable SCORM resource was found in imsmanifest.xml"
            )
        actual_launch = safe_names.get(launch_file.lower())
        if actual_launch is None:
            raise IspringPackageValidationError(
                "The launch file declared by the manifest is missing"
            )

    return ValidatedPackage(
        archive_bytes=archive_bytes,
        launch_file=_safe_member_name(actual_launch),
        checksum_sha256=hashlib.sha256(archive_bytes).hexdigest(),
    )


def read_package_member(archive_bytes: bytes, requested_path: str) -> tuple[bytes, str]:
    safe_path = _safe_member_name(posixpath.normpath(requested_path))
    try:
        with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
            names = {name.replace("\\", "/").lower(): name for name in archive.namelist()}
            actual_name = names.get(safe_path.lower())
            if actual_name is None:
                raise FileNotFoundError(safe_path)
            return archive.read(actual_name), safe_path
    except zipfile.BadZipFile as exc:
        raise FileNotFoundError(safe_path) from exc
