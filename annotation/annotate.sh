#!/bin/bash

# __author__ = "Catherine Smith, Matthew Brook O'Donnell, J. de Joode" (in arbirary order)

# runs the paragraphs and find_extra_chapter_title scripts of a directory of text file
# the file needs to be run as
#     ./annotate.sh input output
#
# where input and output are the names of a directory (without a backslash at the end)
# 
# The input directory should have the same name as the subcorpus you are importing, e.g.
# ntc / dickens / ChiLit

STARTTIME=$(date +%s)

SCRIPT_DIR=$( pwd )

PYTHON="$(pwd)/bin/python"

# Convert the relatives path into absolute ones, dereference globs, input directories
INPUT=$([ -d "$1" ] && readlink -f "$1/*.txt" || readlink -f "$1")
OUTPUT_DIR=$(readlink -f "$2")

# Make sure all output dirs exist
mkdir -p $OUTPUT_DIR/{ascii,paragraphs,sentences,quotes,suspensions,alternativequotes,alternativesuspensions,final}

git_version() {
    (
        cd $1
        git describe --exact-match HEAD 2>/dev/null \
            || echo $(git rev-parse --abbrev-ref HEAD):$(git rev-parse --short HEAD)
    )
}

for i in ${INPUT}; do
	nf="$(basename $i .txt).xml"

	echo '--------------------------------------------------'
	echo "Input -- $i"

        [ "$nf" = "thejungle.xml" ] && {
            echo "$nf is broken. Skipping..."
            continue
        }

	echo "Stage 1 -- ascii7: $OUTPUT_DIR/ascii/$nf"
	perl -C -MText::Unidecode -n -e'print unidecode($_)' $i > $OUTPUT_DIR/ascii/$(basename $i)

        [ "$nf" = "heart.xml" ] && {
            # Bodge out embedded-embedded quotes
            sed -i 's/"Each station should be like a beacon on the/Each station should be like a beacon on the/' $OUTPUT_DIR/ascii/$(basename $i)
            sed -i 's/humanizing, improving, instructing\."/humanizing, improving, instructing\./' $OUTPUT_DIR/ascii/$(basename $i)
            # Bodge out extra long quotes
            sed -i 's/^"Girl\! What/Girl\! What/' $OUTPUT_DIR/ascii/$(basename $i)
        }

	echo "Stage 1 -- paragraph extraction: $OUTPUT_DIR/paragraphs/$nf"
	${PYTHON} $SCRIPT_DIR/paragraphs.py $OUTPUT_DIR/ascii/$(basename $i) "$(basename $(dirname $i))" $OUTPUT_DIR/paragraphs/$nf

	echo "Stage 2 -- extracting sentences: $OUTPUT_DIR/sentences/$nf"
	${PYTHON} $SCRIPT_DIR/sentences.py $OUTPUT_DIR/paragraphs/$nf $OUTPUT_DIR/sentences/$nf

	echo "Stage 3 -- adding milestones for quotes: $OUTPUT_DIR/quotes/$nf"
	${PYTHON} $SCRIPT_DIR/quotes.py $OUTPUT_DIR/sentences/$nf $OUTPUT_DIR/quotes/$nf

	echo "Stage 4 -- adding milestones for suspensions: $OUTPUT_DIR/suspensions/$nf"
	${PYTHON} $SCRIPT_DIR/suspensions.py $OUTPUT_DIR/quotes/$nf $OUTPUT_DIR/suspensions/$nf

	echo "Stage 5 -- adding milestones for alternative quotes: $OUTPUT_DIR/alternativequotes/$nf"
	${PYTHON} $SCRIPT_DIR/alternativequotes.py $OUTPUT_DIR/suspensions/$nf $OUTPUT_DIR/alternativequotes/$nf

	echo "Stage 6 -- adding milestones for alternative suspensions: $OUTPUT_DIR/alternativesuspensions/$nf"
	${PYTHON} $SCRIPT_DIR/alternativesuspensions.py $OUTPUT_DIR/alternativequotes/$nf $OUTPUT_DIR/alternativesuspensions/$nf

	echo "Final -- adding stylesheet declaration: $OUTPUT_DIR/final/$nf"
	echo '<?xml-stylesheet href="/annotationOutput/styles.css"?>' | cat - $OUTPUT_DIR/alternativesuspensions/$nf > $OUTPUT_DIR/final/$nf

        [ "$nf" = "heart.xml" ] && {
            # Bodge back in embedded-embedded quotes
            sed -i 's/Each station should be like a beacon on the/"Each station should be like a beacon on the/' $OUTPUT_DIR/final/$nf
            sed -i 's/humanizing, improving, instructing\./humanizing, improving, instructing\."/' $OUTPUT_DIR/final/$nf
            # Make extra long quote a quote again
            # NB: This doesn't resolve the situation entirely, but close enough for cheshire3
            sed -i 's/>Girl\!<\/s>/><qs\/>"Girl\!\<\/s>/' $OUTPUT_DIR/final/$nf
            sed -i 's/<qs\/>"Poor fool\!<\/s>/"Poor fool\!<\/s>/' $OUTPUT_DIR/final/$nf

            # Reposition start of extended quotes at chapter-start
            sed -i 's/"One evening as I was lying flat on the deck of my steamboat/<qs\/>"One evening as I was lying flat on the deck of my steamboat/' $OUTPUT_DIR/final/$nf
            sed -i 's/<qs\/>"I was broad awake by this time/"I was broad awake by this time/' $OUTPUT_DIR/final/$nf
            sed -i 's/"I looked at him, lost in astonishment\./<qs\/>"I looked at him, lost in astonishment./' $OUTPUT_DIR/final/$nf
            sed -i 's/<qs\/>"The manager came out.<\/s>/"The manager came out.<\/s>/' $OUTPUT_DIR/final/$nf

            # Remove incorrectly-detected embedded-quote
            sed -i 's/<qs\/>"Clear this poor devil out of the country/"Clear this poor devil out of the country/' $OUTPUT_DIR/final/$nf
            sed -i 's/the kind of men you can dispose of with me\."<qe\/>/the kind of men you can dispose of with me\."/' $OUTPUT_DIR/final/$nf
        }
done

echo 'Finished and now cleaning up. Find your results in the directory `final` in your output directory.'

# Note which versions we processed
VERSIONS_DIR="$SCRIPT_DIR/../annotationOutput/versions"
mkdir -p $VERSIONS_DIR
git_version $SCRIPT_DIR > $VERSIONS_DIR/clic
git_version $SCRIPT_DIR/../corpora/ > $VERSIONS_DIR/corpora

ENDTIME=$(date +%s)
echo "It took $(($ENDTIME - $STARTTIME)) seconds to complete this annotation."
