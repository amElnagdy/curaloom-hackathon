import pytest

from sam_tokens import Box, box_prompt, mask_raster, parse

# Two records from dev.meta.ai/docs/sam/reading-segmentation (prompt "button", 320x334 frame).
DOC_LINE = (
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>,"
    "1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|>"
    "<|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>"
)


def test_parse_reads_every_record_box_and_mask_header():
    records = parse(DOC_LINE)

    assert [(r.frame, r.object_id) for r in records] == [(0, 0), (0, 1)]
    assert records[0].box == Box(211, 228, 270, 254, 320, 334, None)
    assert (records[1].mask.height, records[1].mask.width, records[1].mask.encoding) == (27, 48, "lossless")
    assert records[1].mask.payload.startswith("~!!!!J")


def test_parse_reads_confidence_on_box_and_ignores_it_in_mask_fields():
    line = "<0f>1<|box;x1=444;y1=625;x2=679;y2=850;w=1800;h=1200;c=0.9609375|><|mask;x=0;y=0;c=0.9609375;data=2,2,!abc|>"

    (record,) = parse(line)

    assert record.box.confidence == pytest.approx(0.9609375)
    assert (record.mask.height, record.mask.width, record.mask.encoding) == (2, 2, "one_bit")


def test_parse_of_empty_output_is_zero_matches():
    assert parse("") == []


def test_mask_raster_decodes_doc_sample_to_box_sized_raster():
    pytest.importorskip("meta_sam_parser")
    (first, _) = parse(DOC_LINE)

    raster = mask_raster(first.mask)

    assert len(raster) == 27 * 60
    assert 0 < sum(raster) < 27 * 60


def test_box_prompt_numbers_objects_and_refuses_more_than_16():
    assert box_prompt([(1, 2, 3, 4)], 10, 20) == "<0f>0<|box;x1=1;y1=2;x2=3;y2=4;w=10;h=20|>"
    with pytest.raises(ValueError):
        box_prompt([(0, 0, 1, 1)] * 17, 10, 10)
