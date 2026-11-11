# RUF Bulletins

The language used to describe RUF's weekly bulletin content and its reusable material.

## Language

**Bulletin**:
An editable composition of scripture, songs, announcements, QR codes, and contacts for one RUF gathering date; there is at most one bulletin per date.
_Avoid_: PDF, YAML file

**Sermon passage**:
An instance of scripture designated for the sermon in a bulletin, with an editable reference and text; a bulletin may have more than one.
_Avoid_: Scripture reading

**Scripture reading**:
An instance of scripture designated for a reading in a bulletin, with an editable reference and text; a bulletin may have more than one.
_Avoid_: Sermon passage

**Song store**:
The shared collection of songs available for selection in a bulletin and maintained separately from the bulletin editor.
_Avoid_: Bulletin song list

**Song key**:
The unique name used by a bulletin to refer to a song in the store; a newly added song with the same key can satisfy an earlier broken reference.
_Avoid_: Song title

**Invitation**:
An admin-issued, single-use registration key for creating a staff account.
_Avoid_: Shared registration key

**Draft**:
A saved bulletin whose content may still be incomplete or contain broken references and therefore may not yet produce a PDF.

**QR asset**:
A reusable uploaded QR image that can be selected for more than one bulletin.
_Avoid_: Bulletin-only QR image
