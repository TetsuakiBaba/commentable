class Speech {
    // Fetch the list of voices and populate the voice options.
    constructor() {
        this.uttr = new SpeechSynthesisUtterance();
    }
    loadVoices() {
        // Fetch the available voices in English US.
        let voices = speechSynthesis.getVoices();
        $("#voice-names").empty();
        voices.forEach(function(voice, i) {
            const $option = $("<option>");
            $option.val(voice.name);
            $option.text(voice.name + " (" + voice.lang + ")");
            $option.prop("selected", voice.name === "Kyoko");
            if (voice.lang == 'ja-JP') $("#voice-names").append($option);
        });
    }

    /*
    // Chrome loads voices asynchronously.
    window.speechSynthesis.onvoiceschanged = function (e) {
        this.loadVoices();
    };
    */



    // Set up an event listener for when the 'speak' button is clicked.
    // Create a new utterance for the specified text and add it to the queue.
    speak(_text, _volume) {
        this.uttr.text = _text;
        this.uttr.rate = parseFloat($("#slider_speed").val());
        if (_volume <= 0.1) _volume = 0.1;
        this.uttr.volume = _volume;
        console.log("volume is " + _volume);
        //this.utter.volume = 0.1;
        // If a voice has been selected, find the voice and set the
        // utterance instance's voice attribute.
        if ($("#voice-names").val()) {
            this.uttr.voice = speechSynthesis
                .getVoices()
                .filter(voice => voice.name == $("#voice-names").val())[0];
        }

        speechSynthesis.speak(this.uttr);
        this.uttr.onend = function() {
            // hoge
        };
    }

    pause() {
        speechSynthesis.pause();
        //speechSynthesis.resume();
        //speechSynthesis.cancel();
    }

}