BEGIN;


CREATE TABLE IF NOT EXISTS corpus (
    corpus_id SERIAL,
    PRIMARY KEY (corpus_id),
    
    name TEXT NOT NULL,
    UNIQUE(name),
    title TEXT NOT NULL,
    carousel_image BYTEA NULL,
    ordering INT NOT NULL DEFAULT 0
);
COMMENT ON TABLE  corpus IS 'Groups of books';
COMMENT ON COLUMN corpus.name IS 'Short name of corpus, e.g. ChiLit';
COMMENT ON COLUMN corpus.title IS 'Title to show in interface, e.g. ''ChiLit - 19th Century Children''s Literature''';
COMMENT ON COLUMN corpus.carousel_image IS 'Bytes of a JPEG carousel image, with a 0.4 width/height ratio';
COMMENT ON COLUMN corpus.ordering IS 'Ordering of corpus items in interface, negative items are hidden';


CREATE TABLE IF NOT EXISTS corpus_book (
    corpus_id INT NOT NULL,
    FOREIGN KEY (corpus_id) REFERENCES corpus(corpus_id) ON DELETE CASCADE,
    book_id INT NOT NULL,
    FOREIGN KEY (book_id) REFERENCES book(book_id) ON DELETE CASCADE
);
COMMENT ON TABLE  corpus_book IS 'Corpus <-> books many-to-many';


COMMIT;
