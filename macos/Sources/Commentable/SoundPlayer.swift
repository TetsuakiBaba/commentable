import AVFoundation

// コメントの効果音と読み上げ
final class SoundPlayer: NSObject, AVAudioPlayerDelegate {
    // id_sound の番号順。複数あるものはランダムに1つ鳴らす
    private static let soundFiles: [[String]] = [
        ["camera1.mp3", "camera2.mp3", "camera3.mp3"],
        ["clap1.mp3", "clap2.mp3", "clap3.mp3", "clap4.mp3", "clap5.mp3", "clap6.mp3", "clap7.mp3", "clap8.mp3"],
        ["cracker.mp3"],
        ["kansei.mp3"],
        ["he.wav"],
        ["chottomatte.wav"],
        ["OK.wav"],
        ["punch.mp3"],
        ["laugh3.mp3"],
        ["kusa00.mp3", "kusa01.mp3", "kusa02.mp3", "kusa03.mp3", "kusa04.mp3", "kusa05.mp3"],
    ]

    var volume: Float = 0.1
    var isMuted = false

    private var cache: [String: Data] = [:]
    private var playing = Set<AVAudioPlayer>() // 再生が終わるまで保持する（同じ音を重ねて鳴らせる）
    private let synthesizer = AVSpeechSynthesizer()

    override init() {
        super.init()
        // 最初のコメントで遅れないように読み込んでおく
        for name in Self.soundFiles.joined() + ["protofessional.mp3"] {
            if let url = Resources.sound(name), let data = try? Data(contentsOf: url) {
                cache[name] = data
            } else {
                NSLog("Sound not found: %@", name)
            }
        }
    }

    func isValidSoundID(_ id: Int) -> Bool {
        Self.soundFiles.indices.contains(id)
    }

    func playComment(soundID: Int) {
        guard isValidSoundID(soundID), let name = Self.soundFiles[soundID].randomElement() else { return }
        play(name, volume: volume)
    }

    func play(_ name: String, volume: Float) {
        guard !isMuted, let data = cache[name], let player = try? AVAudioPlayer(data: data) else { return }
        player.volume = volume
        player.delegate = self
        playing.insert(player)
        player.play()
    }

    func speak(_ text: String) {
        guard !isMuted else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "ja-JP")
        utterance.volume = volume
        synthesizer.speak(utterance)
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        playing.remove(player)
    }
}
